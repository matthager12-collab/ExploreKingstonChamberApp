// The kiosk's ONLY way to send a visitor somewhere that is not a kiosk screen.
//
// THE RULE (docs/KIOSK.md §3, and a hard "never" in the E22 charter): a kiosk
// must never open a third-party site in its own browser. That is precisely how
// a walk-up visitor escapes the lockdown and strands a wall-mounted panel on
// somebody's cookie banner, with no address bar and no back button, until a
// human notices. So every destination the website would render as a link — a
// menu, an ordering page, a phone number, a booking site, or one of our own
// mobile pages — becomes a QR code here instead. The visitor's phone opens it;
// the kiosk never moves.
//
// Rendered as an INLINE <svg> from a vendored encoder (src/lib/qr): no hosted
// QR service, no CDN, no network call, nothing for a CSP to allow. Server
// component, so the encoding cost is paid once per ISR revalidation rather than
// on a low-power mini PC's main thread.

import { encodeQr, qrPath, Ecc } from "@/lib/qr";

/** Modules of white margin. Four is the spec minimum for reliable scanning. */
const QUIET_ZONE = 4;

export function KioskQr({
  value,
  caption,
  hint,
  size = "md",
}: {
  /** The destination encoded in the code. Absolute — a phone is not on this origin. */
  value: string;
  /** What this opens, e.g. "Sound Brewery — menu". Read out, not decoration. */
  caption: string;
  /** Optional second line, e.g. the human-readable domain. */
  hint?: string;
  size?: "sm" | "md";
}) {
  // QUARTILE rather than MEDIUM: this code gets photographed off a glossy panel
  // in daylight, at an angle, often through glass, by a phone its owner is not
  // holding still. The extra redundancy costs a slightly denser symbol and buys
  // back exactly the failure mode this deployment has.
  const matrix = encodeQr(value, Ecc.QUARTILE);
  const dim = matrix.size + QUIET_ZONE * 2;
  const px = size === "sm" ? "h-40 w-40" : "h-56 w-56";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        data-qr
        // The vector box is in MODULE units and the element is sized by CSS, so
        // the code stays crisp at any stage scale — a rasterised QR resampled by
        // the stage transform is the classic reason a kiosk code will not scan.
        viewBox={`0 0 ${dim} ${dim}`}
        className={`${px} rounded-lg bg-white p-2`}
        role="img"
        aria-label={`QR code: ${caption}`}
        shapeRendering="crispEdges"
      >
        <rect width={dim} height={dim} fill="#ffffff" />
        <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`}>
          {/* Pure black, not a brand token: scanners threshold on luminance and
              the navy would cut the contrast ratio for no design benefit. */}
          <path d={qrPath(matrix)} fill="#000000" />
        </g>
      </svg>
      <p className="max-w-56 text-center text-xl leading-snug font-semibold text-white">{caption}</p>
      {hint && (
        // The destination in words. A visitor who cannot or will not scan still
        // learns where this would have taken them, and it is the honest label
        // for a code that leaves our site entirely.
        <p className="max-w-56 text-center text-lg break-words text-white/70">{hint}</p>
      )}
    </div>
  );
}

/** The domain of a URL, for the human-readable hint under a code. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
