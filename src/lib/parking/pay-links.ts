// Tap-to-pay hand-offs for the paid lots.
//
// No money moves through this app and there is no integration with any vendor.
// Each paid lot already runs on a payment rail with a public consumer flow; all
// we do is open it, pre-loaded with the zone code. That is why this file is
// pure string-building with no network, no key and no backend — and why the
// visible code text below is not a nicety but the actual product: on iOS the
// `sms:` body pre-fill is unreliable and on desktop the scheme usually no-ops,
// so "Text POKHILL to 25023" is what works when the button does not.
//
// Pure: safe on the server (the pay card renders server-side) and in tests.

import type { PayHandoff } from "@/lib/data/parking";

/**
 * The href a "Pay now" control points at.
 *
 * T2 keeps BOTH `?body=` and `&body=`, deliberately. iOS historically treated
 * `sms:NUMBER&body=…` as the query and Android/others `sms:NUMBER?body=…`;
 * neither is specified, both ignore the separator they do not recognise, and
 * the failure mode of picking wrong is a message with no text in it. Carrying
 * both costs a few characters no user ever sees.
 */
export function payHref(p: PayHandoff): string {
  switch (p.vendor) {
    case "t2": {
      const body = encodeURIComponent(p.code);
      const to = encodeURIComponent(p.shortCode ?? "");
      return `sms:${to}?body=${body}&body=${body}`;
    }
    case "parkmobile":
      // Web deep-link that pre-fills the zone. Verified for Diamond D515
      // (zone 97599515) — see docs/PARKING-PAY-LINKS.md's verify-before-relying
      // list, which flags this URL shape as liable to drift.
      return `https://app.parkmobile.io/zone/start?internalZoneCode=${encodeURIComponent(p.code)}`;
    case "paybyphone":
      // No documented zone-prefill URL exists. Opening the site and letting the
      // posted location code do the work is honest; inventing a query parameter
      // would break silently and look like our bug.
      return "https://www.paybyphone.com/";
  }
}

/**
 * The human instruction, always shown alongside the button.
 *
 * This is the fallback that carries iOS and desktop, so it must stand alone and
 * make sense read aloud — never "tap the button above".
 */
export function payInstruction(p: PayHandoff): string {
  switch (p.vendor) {
    case "t2":
      return `Text ${p.code} to ${p.shortCode}`;
    case "parkmobile":
      return `ParkMobile zone ${p.code}`;
    case "paybyphone":
      return "PayByPhone — use the location code posted on the lot sign";
  }
}

/** Default button label when a hand-off carries no override. */
export function payLabel(p: PayHandoff): string {
  if (p.label?.trim()) return p.label.trim();
  switch (p.vendor) {
    case "t2":
      return "Pay by text";
    case "parkmobile":
      return "Pay with ParkMobile";
    case "paybyphone":
      return "Pay with PayByPhone";
  }
}

/**
 * Group zones that share a hand-off, so three POKPARK rows become one card.
 *
 * A visitor reading a list of places to pay does not care that the Port splits
 * POKPARK across three polygons — they care that there is one code. Keyed on
 * the hand-off itself, so the day the Port gives one of those rows its own code
 * it separates automatically rather than needing this list re-edited.
 */
export function payGroupKey(pay: PayHandoff[]): string {
  return pay.map((p) => `${p.vendor}:${p.code}:${p.shortCode ?? ""}`).join("|");
}
