// E11 consumer privacy-request intake (M-15-05 / FR-A22): the public "see my
// data / delete my data / public-records request" loop. POST
// { kind: "access"|"delete"|"records", contact, note? } — NO ACCOUNT required
// (NFR-07), rate-limited and body-capped like the report route. Creates a
// worklist item of type `privacy_request` carrying a 45-day due date (RCW
// 19.373's response window); a human fulfills it in the E08 worklist UI.
//
// The worklist wants a subject (store, id, label); a privacy request has no
// natural subject record, so we mint a SYNTHETIC one — store "privacy", a
// random uuid, and a PII-FREE label (the kind + date, never the contact). The
// contact lives only in the payload, is kept out of the immortal audit table
// (D-12: stripRequestContact), and is scrubbed from the row at resolution.

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { createWorklistItem } from "@/lib/stores/worklist-store";
import { WorklistValidationError } from "@/lib/schemas/worklist";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;
const RESPONSE_WINDOW_DAYS = 45;
const KINDS = ["access", "delete", "records"] as const;

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many requests, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const ipLimit = await checkRateLimit(clientKey(request, "privacy-request"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "kind must be access, delete, or records" }, { status: 400 });
  }
  if (!contact) {
    return NextResponse.json({ error: "a way to reach you is required" }, { status: 400 });
  }

  const dueAt = new Date(Date.now() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60_000);
  const subjectId = randomUUID();
  const label = `${kind} request — ${new Date().toISOString().slice(0, 10)}`;

  try {
    await createWorklistItem(
      {
        type: "privacy_request",
        subjectStore: "privacy",
        subjectId,
        subjectLabel: label, // no PII: kind + date only
        payload: {
          requestKind: kind,
          contact,
          ...(note ? { scopeNote: note } : {}),
        },
        dueAt,
      },
      { actor: "public", source: "public" },
    );
  } catch (err) {
    if (err instanceof WorklistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({
    ok: true,
    message: `Request received. We respond within ${RESPONSE_WINDOW_DAYS} days.`,
  });
}
