// POST /api/webhooks/zeffy — Zeffy's payment events. Outside /api/admin on
// purpose: src/proxy.ts must never 401 it, and it authenticates by signature.
//
// Order: rate limit → body cap → raw body → secret configured (503 fail-
// closed) → signature on the RAW bytes → parse → campaign filter → 200, then
// a full resync AFTER the response (`after`, stable on the standalone Docker
// target). No per-event branching: every delivery — created, updated,
// deleted, a retry — is answered by the same idempotent resync from the API,
// so the payload is never trusted for data, only as a nudge.
//
// The webhook is per organisation and fires for every campaign (donations
// too); anything naming another campaign is acknowledged and ignored.

import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runRaceSync } from "@/lib/race/sync";
import { verifyZeffySignature } from "@/lib/race/webhook-signature";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** A payment event with 100 line items is well under 100 KB. */
const MAX_BODY_BYTES = 256 * 1024;

const eventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    data: z.object({ campaign_id: z.string().optional() }).passthrough(),
  })
  .passthrough();

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(clientKey(request, "zeffy-webhook"), { limit: 120, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isInteger(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const secret = process.env.ZEFFY_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });

  if (!verifyZeffySignature(raw, request.headers.get("zeffy-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  if (!event.type.startsWith("payment.")) return NextResponse.json({ ignored: true });
  const campaignId = process.env.ZEFFY_CAMPAIGN_ID?.trim();
  if (event.data.campaign_id && campaignId && event.data.campaign_id !== campaignId) {
    return NextResponse.json({ ignored: true });
  }

  after(async () => {
    try {
      await runRaceSync("webhook");
    } catch (err) {
      console.error("zeffy webhook resync failed", err instanceof Error ? err.message : "unknown");
    }
  });
  return NextResponse.json({ ok: true });
}
