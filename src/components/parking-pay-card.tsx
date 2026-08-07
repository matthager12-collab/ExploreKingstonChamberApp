// A "pay here" card for one paid lot — our answer to the Port's posted sign.
//
// DELIBERATELY NOT A REPLICA. It carries the same information in the same
// reading order as the sign bolted to the fence, because that order is right:
// which lot, then the code, then the way to pay. But it wears Explore Kingston's
// palette, does not reproduce the Port's logo or its sign layout, and names the
// Port as the source rather than speaking as them. A card that could be
// screenshotted and mistaken for official Port signage would be a liability the
// moment a rate changed, and the Chamber is not the Port.
//
// A SERVER component. The QR is encoded at render time by the vendored encoder
// in src/lib/qr — no dependency, no hosted QR service, nothing for the CSP to
// allow, and no client JavaScript for something that never changes after paint.
// It also means the card prints, and survives with JS off.
//
// The visible instruction is not decoration: on iOS the `sms:` body pre-fill is
// unreliable and on desktop the scheme usually no-ops, so "Text POKPARK to
// 25023" is what actually works when the button does not. Never hide it behind
// the button, and never word it as "tap the button above".

import { Ecc, encodeQr, qrPath } from "@/lib/qr";
import type { MapZone, PayHandoff } from "@/lib/data/parking";
import { payHref, payInstruction, payLabel } from "@/lib/parking/pay-links";

const QUIET_ZONE = 4;

/**
 * Card titles for the Port's three text-to-pay codes.
 *
 * Keyed by code rather than taken from the zone name, because a card can cover
 * several zones — POKPARK is three polygons — and titling it from the first one
 * gives you "north rows", which is a fragment of a map label, not a lot. The
 * wording matches what the Port prints on its own PAY HERE signs, so a visitor
 * comparing the two sees the same words.
 */
const CODE_TITLES: Record<string, string> = {
  POKPARK: "General parking",
  POKHILL: "Hill parking",
  POKTT: "Truck & trailer parking",
};

function PayQr({ value, label }: { value: string; label: string }) {
  const matrix = encodeQr(value, Ecc.QUARTILE);
  const dim = matrix.size + QUIET_ZONE * 2;
  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      className="h-24 w-24 shrink-0 rounded-lg bg-white"
      role="img"
      aria-label={`QR code: ${label}`}
      shapeRendering="crispEdges"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`}>
        {/* Pure black — scanners threshold on luminance, so a brand navy would
            cost contrast for no visible benefit. */}
        <path d={qrPath(matrix)} fill="#000000" />
      </g>
    </svg>
  );
}

export function ParkingPayCard({
  title,
  spaces,
  pay,
  note,
}: {
  /** What a driver calls this lot — "General parking", not the zone id. */
  title: string;
  /** Space numbers, when the lot has them: "1–103, 181–233". */
  spaces?: string;
  pay: PayHandoff[];
  /** One line of rate or restriction detail. */
  note?: string;
}) {
  const primary = pay[0];
  if (!primary) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-sand bg-white">
      {/* Header band. The Port's sign leads with a P mark and "PAY HERE"; so
          does this, because that is what makes it findable at a glance in a
          list — but in our navy, with our wording. */}
      <div className="flex items-center gap-3 bg-sound-deep px-4 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-seaglass text-lg font-extrabold text-seaglass"
        >
          P
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold tracking-wide text-white uppercase">
            Pay here
          </p>
          <p className="truncate text-sm text-seaglass">{title}</p>
        </div>
      </div>

      <div className="p-4">
        {spaces && (
          <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
            Spaces {spaces}
          </p>
        )}

        <div className="mt-2 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {/* The code, set as the largest thing on the card. It is the one
                piece of information that still works with no signal, no app,
                and a dead phone handed to a friend. */}
            <p className="text-lg leading-snug font-extrabold text-ink">
              {payInstruction(primary)}
            </p>
            {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              {pay.map((p, i) => (
                <a
                  key={`${p.vendor}-${p.code}-${i}`}
                  href={payHref(p)}
                  className="inline-flex min-h-[44px] items-center rounded-full bg-tide-deep px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sound"
                >
                  {payLabel(p)} →
                </a>
              ))}
            </div>
          </div>

          {/* Same destination as the button, for the desktop reader and for
              anyone whose phone will scan but will not follow an sms: link. */}
          <div className="hidden sm:block">
            <PayQr value={payHref(primary)} label={payInstruction(primary)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Card title from a zone name.
 *
 * Zone names are written for the map's popup ("POKPARK main lot fan (spaces
 * 1–88)") where the code and the numbers are the point. On a card the code is
 * already the headline and the spaces have their own line, so both are stripped
 * — what is left is the thing a driver would say out loud.
 */
/**
 * The space numbers a group of zones covers, e.g. "1–88, 89–103, 181–233".
 *
 * Read out of the zone NAMES rather than stored separately, because the names
 * are already the reviewed place those ranges live ("POKPARK row 89–103") and a
 * second copy would be a second thing to keep true. Sorted by first number so
 * the list reads the way a driver scans it, and silently empty for a lot with
 * no numbered spaces — Diamond D515 has none.
 */
export function spacesLabel(zones: MapZone[]): string | undefined {
  const ranges: { from: number; text: string }[] = [];
  for (const z of zones) {
    for (const m of z.name.matchAll(/(\d{1,3})\s*[–—-]\s*(\d{1,3})/g)) {
      const text = `${m[1]}–${m[2]}`;
      if (!ranges.some((r) => r.text === text)) {
        ranges.push({ from: Number(m[1]), text });
      }
    }
  }
  if (ranges.length === 0) return undefined;
  return ranges
    .sort((a, b) => a.from - b.from)
    .map((r) => r.text)
    .join(", ");
}

export function payCardTitle(zones: MapZone[]): string {
  const code = zones[0]?.pay?.[0];
  if (code?.vendor === "t2" && CODE_TITLES[code.code]) return CODE_TITLES[code.code];
  // Everything else is a single named lot (Diamond D515), where the zone name
  // already is what a driver would call it.
  return (zones[0]?.name ?? "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+—.*$/, "")
    .trim();
}

/**
 * The rate line, without the parts the card already shows.
 *
 * Zone summaries are written for the map popup, where they have to carry
 * everything — so they end with "text POKPARK to 25023. Spaces 181–190, …".
 * On the card the code is the headline and the spaces have their own line, so
 * repeating them here would make the one genuinely new fact, the price, the
 * third thing you read.
 */
export function payCardNote(zone: MapZone): string | undefined {
  const head = zone.summary.split(/\s+—\s+/)[0]?.trim();
  return head && head.length > 3 ? head : undefined;
}
