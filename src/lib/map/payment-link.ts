// Allowlist for parking.paymentLink. The old check (/^(https?:\/\/|[a-z]+:\/\/)/i)
// accepted ANY scheme — javascript://%0aalert(1) passed and was rendered as a
// clickable href in public map popups (feature-map.tsx). Real-world values
// per docs/PARKING-PAY-LINKS.md are https:// (ParkMobile/PayByPhone), sms:
// (T2 zone text-to-pay), and occasionally tel:.

const ALLOWED_SCHEME_RE = /^(https:\/\/|sms:|tel:)/i;

export function isAllowedPaymentLink(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 500 && ALLOWED_SCHEME_RE.test(trimmed);
}
