// E33 — the amenity truth block (/line, slice 3).
//
// The honest answer to "is there a restroom near me?" for a car parked west of
// Lindvog Rd. Purely data-driven over the sourced amenities layer (M-19-03 —
// every pin traces to a source). If the Chamber maps a genuinely walkable
// amenity at /admin/maps it appears here with no deploy — which is exactly how
// the current one arrived.
//
// E33 Open question 2 is ANSWERED (2026-08-01): the Chamber confirmed a
// portable toilet at the boarding-pass dispenser west of Lindvog Rd. It is the
// first amenity ever to land in the `walkable` half, so this block no longer
// leads with the empty state — the empty branch is kept because the split is
// data-driven and a future data change could empty it again.

import type { LineAmenitySplit } from "@/lib/line-lander";
import { markerCategory } from "@/lib/map/types";
import { copyText } from "@/lib/stores/site-store";
import { CostBadge } from "@/components/cost-badge";
import { Card } from "@/components/ui";

function AmenityList({ rows, fromLine }: { rows: LineAmenitySplit["walkable"]; fromLine: boolean }) {
  return (
    <ul className="mt-2 divide-y divide-sand">
      {rows.map(({ feature, lineWalkMinutes }) => {
        const cat = markerCategory(feature.category);
        return (
          <li key={feature.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
            <span className="min-w-0">
              <span className="font-medium text-ink">
                <span aria-hidden="true">{cat.emoji}</span> {feature.title}
              </span>
              {/* Category in TEXT, never colour alone (WCAG 1.4.1). */}
              <span className="ml-2 text-xs text-ink-soft">{cat.label}</span>
              {feature.cost && (
                <span className="ml-2 align-middle">
                  <CostBadge cost={feature.cost} />
                </span>
              )}
              {feature.notes && (
                <span className="mt-0.5 block text-xs text-ink-soft">{feature.notes}</span>
              )}
            </span>
            {fromLine && (
              <span className="text-sm whitespace-nowrap tabular-nums text-ink-soft">
                ~{lineWalkMinutes} min from the line
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LineAmenities({
  split,
  copy,
}: {
  split: LineAmenitySplit;
  copy: Record<string, string>;
}) {
  return (
    <Card>
      {split.walkable.length > 0 ? (
        <div>
          {/* Heading + note only exist on this branch. Until the portable toilet
              at the pass dispenser was mapped (Aug 2026) this list was always
              empty, so "~N min from the line" had never actually rendered —
              and unlabelled it reads as "N min from ME" to someone parked a
              mile back at Barber Cutoff. The note says what it is measured
              from. */}
          <h3 className="text-sm font-semibold text-sound-deep">
            {copyText(copy, "line.amenities.walkableTitle")}
          </h3>
          <AmenityList rows={split.walkable} fromLine />
          <p className="mt-2 text-xs text-ink-soft">
            {copyText(copy, "line.amenities.walkableNote")}
          </p>
        </div>
      ) : (
        <p className="text-ink">{copyText(copy, "line.amenities.empty")}</p>
      )}

      {split.atTerminal.length > 0 && (
        <div className="mt-4 border-t border-sand pt-4">
          <h3 className="text-sm font-semibold text-sound-deep">
            {copyText(copy, "line.amenities.atDock")}
          </h3>
          <AmenityList rows={split.atTerminal} fromLine={false} />
        </div>
      )}
    </Card>
  );
}
