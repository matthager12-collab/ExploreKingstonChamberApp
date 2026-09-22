// The database half of race-day link validation: a token that verifies
// (signature, expiry — see checkin-token.ts) is honoured only while its
// version matches race_checkin_link and the link is neither revoked nor
// past its expiry. Used by the /checkin page and the api/checkin routes.

import "server-only";

import { race } from "@/lib/data/race";
import { getCheckinLink } from "@/lib/db/race-registrants";

import { verifyCheckinToken, type CheckinClaims } from "./checkin-token";

export async function readCheckinAccess(
  token: string | undefined,
  now: number = Date.now(),
): Promise<CheckinClaims | null> {
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return null;
  const claims = verifyCheckinToken(token, secret, now);
  if (!claims || claims.raceId !== race.id) return null;
  const link = await getCheckinLink(claims.raceId);
  if (!link || link.revokedAt || link.version !== claims.v) return null;
  if (link.expiresAt.getTime() <= now) return null;
  return claims;
}
