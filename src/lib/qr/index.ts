// QR helpers for the kiosk — matrix to SVG path, and the handoff-URL rule.

import { absoluteUrl } from "@/lib/site-url";
import { encodeQr, Ecc, type QrMatrix } from "./qr-encoder";

export { encodeQr, Ecc };
export type { QrMatrix };

/**
 * The kiosk's phone-handoff URL for an in-app path.
 *
 * Absolute, because the visitor's phone is not on this origin and a relative
 * href in a QR is meaningless. utm_source=kiosk so the Chamber can show LTAC
 * how many walk-ups the panel actually converts into phone sessions — the whole
 * argument for the QR-instead-of-link design being a funnel rather than a
 * dead end (docs/KIOSK.md §3).
 *
 * NEXT_PUBLIC_SITE_URL is inlined at build time, so a kiosk built before the
 * custom domain cut over will encode the old origin until the image is rebuilt.
 * That is called out in docs/KIOSK-DEPLOY.md rather than worked around here.
 */
export function kioskHandoffUrl(path: string): string {
  const base = absoluteUrl(path);
  return `${base}${base.includes("?") ? "&" : "?"}utm_source=kiosk`;
}

/**
 * Render a QR matrix as ONE SVG path `d` string, in module coordinates.
 *
 * One path rather than a rect per module: a version-11 symbol is 61x61, so the
 * naive form emits well over a thousand elements per code and a screen showing
 * a dozen listings would ship a megabyte of DOM to a low-power mini PC. Each
 * dark module contributes a 1x1 subpath, which every renderer collapses
 * efficiently.
 */
export function qrPath(m: QrMatrix): string {
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (m.get(x, y)) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}
