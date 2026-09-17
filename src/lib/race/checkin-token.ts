// Race-day check-in link: a stateless HMAC token, built like the session
// token in src/lib/auth/tokens.ts. Pure — no database, no request scope.
//
// The token carries the race id, a link VERSION and an expiry. The version
// must equal race_checkin_link.version when the token is used, so minting a
// new link or revoking bumps the version and every older link dies at once —
// the sessionVersion pattern, with no token ledger. Signature + expiry are
// checked here; the version check needs the database and belongs to the
// route (see api/checkin/*).

import { createHmac, timingSafeEqual } from "crypto";

export const CHECKIN_COOKIE = "race_checkin";

export interface CheckinClaims {
  raceId: string;
  /** race_checkin_link.version at mint time. */
  v: number;
  /** Unix ms. */
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`race-checkin.${payload}`).digest("base64url");
}

export function makeCheckinToken(claims: CheckinClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Signature + expiry + shape. Null for anything malformed, tampered, signed
 *  under another secret, or expired. The caller still checks the version. */
export function verifyCheckinToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): CheckinClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<CheckinClaims>;
    if (typeof data.raceId !== "string" || !data.raceId) return null;
    if (typeof data.v !== "number" || !Number.isInteger(data.v) || data.v < 1) return null;
    if (typeof data.exp !== "number" || data.exp <= now) return null;
    return { raceId: data.raceId, v: data.v, exp: data.exp };
  } catch {
    return null;
  }
}

/** Cookie attributes for the redeemed link. Path "/" because the check-in
 *  page and its API route live under different prefixes. */
export function checkinCookieOptions(exp: number, now: number = Date.now()) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(1, Math.floor((exp - now) / 1000)),
  };
}
