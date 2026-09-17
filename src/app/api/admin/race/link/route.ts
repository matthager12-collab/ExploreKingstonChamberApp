// POST /api/admin/race/link { action: "mint" | "revoke" } — the race-day
// volunteer link. Minting bumps race_checkin_link.version and returns a URL
// carrying a signed token bound to that version; every earlier link stops
// working. Revoking bumps the version again with no new token.
//
// The URL is returned ONCE and never stored: the token is a bearer secret.
// 401 signed out · 403 not admin.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser, requireAdmin } from "@/lib/auth";
import { race } from "@/lib/data/race";
import { mintCheckinLink, revokeCheckinLink } from "@/lib/db/race-registrants";
import { makeCheckinToken } from "@/lib/race/checkin-token";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["mint", "revoke"]) }).strict();
const DAY_MS = 24 * 3600 * 1000;

/** Race day plus a night's grace; if that is already past (a rehearsal after
 *  the race, a next-year dry run), a day from now. */
function linkExpiry(now: number): Date {
  const raceEnd = new Date(race.end).getTime() + 12 * 3600 * 1000;
  return new Date(raceEnd > now ? raceEnd : now + DAY_MS);
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = (await getSessionUser())!;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.action === "revoke") {
    const revoked = await revokeCheckinLink(race.id);
    return NextResponse.json({ revoked });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "Server is missing AUTH_SECRET." }, { status: 503 });

  const expiresAt = linkExpiry(Date.now());
  const link = await mintCheckinLink(race.id, expiresAt, user.id);
  const token = makeCheckinToken({ raceId: race.id, v: link.version, exp: expiresAt.getTime() }, secret);
  const url = `${siteUrl()}/api/checkin/redeem?token=${encodeURIComponent(token)}`;
  return NextResponse.json({ url, version: link.version, expiresAt: expiresAt.toISOString() });
}
