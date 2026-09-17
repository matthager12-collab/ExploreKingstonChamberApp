// Zeffy webhook signatures (https://www.zeffy.com/api/docs, "Webhook
// signatures"): `Zeffy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of
// "{t}.{rawBody}" keyed with the whsec_ secret>`. Verified on the RAW body
// bytes before any JSON parsing, with a constant-time compare and a
// timestamp tolerance against replay. Pure, so it is unit-testable.

import { createHmac, timingSafeEqual } from "crypto";

/** Zeffy's own recommendation. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function signZeffyPayload(rawBody: string, secret: string, timestampSeconds: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
  return `t=${timestampSeconds},v1=${v1}`;
}

export function verifyZeffySignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!header || !secret) return false;
  const parts = new Map<string, string>();
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) parts.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1") ?? "";
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(v1, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
