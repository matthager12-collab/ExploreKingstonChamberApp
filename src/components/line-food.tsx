// E33 — "food you can order from the line" (/line, slice 3).
//
// Server-rendered list of the restaurants that are open RIGHT NOW (the page
// revalidates every 60s, and the client-side OrderTimingNote re-checks live so
// a kitchen that closed mid-cache-window still warns before someone orders).
//
// COMPOSITION CONTRACT (00-DECISIONS §4, VISION-LINESIDE-DELIVERY §7 seam #3):
// ordering is DEEP LINKS OUT — the restaurant's own site or phone line. No
// order capture, no payment, no courier logic, ever. The app is never
// merchant-of-record; this component renders <a href> and nothing else.

import type { LineFoodRow } from "@/lib/line-lander";
import { copyText } from "@/lib/stores/site-store";
import { OpenBadge, OrderTimingNote } from "@/components/open-badge";
import { Card } from "@/components/ui";

function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

const buttonBase =
  "inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-sm font-semibold";

export function LineFood({
  rows,
  copy,
}: {
  rows: LineFoodRow[];
  copy: Record<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-ink">{copyText(copy, "line.food.empty")}</p>
      </Card>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm font-medium text-coral-deep">
        {copyText(copy, "line.food.stayNote")}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map(({ restaurant: r }) => (
          <li key={r.id}>
            <Card className="h-full">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-lg font-semibold text-sound-deep">{r.name}</h3>
                <p className="text-sm text-ink-soft">{r.cuisine}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <OpenBadge weeklyHours={r.weeklyHours} />
                {/* Deliberately the DOCK walk figure, not a "from the line"
                    one. The list is SORTED by distance to the line (the epic's
                    rule), but the holding line's east end is the terminal, so
                    "~1 min from the line" would be true of a downtown kitchen
                    while the reader sits two miles west of Lindvog — a number
                    that invites exactly the leave-the-line dash the block
                    above warns against. The dock walk is the decision figure
                    for order-ahead (pickup happens once you're parked), and
                    it is the same hand-calibrated street estimate /eat shows,
                    so the two pages can never disagree (geo.ts: never mix the
                    calibrated and straight-line figures on one screen). */}
                <span className="text-sm tabular-nums text-ink-soft">
                  {r.walkMinutesFromFerry} min walk from the dock
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {r.orderingUrl && (
                  <a
                    href={r.orderingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${buttonBase} bg-coral text-white hover:bg-coral-deep`}
                  >
                    Order online
                    <span className="sr-only"> from {r.name} (opens their ordering site)</span>
                  </a>
                )}
                {r.phone && (
                  <a
                    href={telHref(r.phone)}
                    className={`${buttonBase} ${
                      r.orderingUrl
                        ? "border border-tide text-tide-deep hover:bg-tide/10"
                        : "bg-coral text-white hover:bg-coral-deep"
                    }`}
                  >
                    Call to order
                    <span className="sr-only"> — phone {r.name}</span>
                  </a>
                )}
                {r.menuUrl && r.menuUrl !== r.orderingUrl && (
                  <a
                    href={r.menuUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${buttonBase} border border-sand text-ink hover:bg-sand`}
                  >
                    Menu
                    <span className="sr-only"> for {r.name}</span>
                  </a>
                )}
                <OrderTimingNote weeklyHours={r.weeklyHours} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">{copyText(copy, "line.food.distanceNote")}</p>
    </div>
  );
}
