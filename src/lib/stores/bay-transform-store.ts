// Per-zone display nudges for the generated Port bay geometry.
//
// A pure overlay store (no git seed): every record is written at runtime by an
// admin at /admin/map, and the generated seed it corrects lives in a static file
// (public/geo/port-stalls.json) rather than in src/lib/data. Regenerating that
// file after a Port revision therefore does NOT discard the corrections — which
// is the whole reason the nudge is a separate record instead of baked geometry.
//
// WHY ITS OWN STORE, NOT A FIELD ON MapZone. `POST /api/admin/parking` rebuilds
// the zone from a field whitelist, so any field not named there is silently
// wiped by the next ordinary save — including a save that only dragged a pin.
// A nudge living on MapZone would survive exactly until the first time someone
// adjusted a shape. Keeping it in its own store sidesteps that trap entirely,
// and it is the honest modelling anyway: a nudge is a correction to a DERIVED
// rendering, not a fact about the zone.
//
// Record id = the MapZone id the bays belong to (`port-pokhill`, …), so the
// composite key (store, id) gives one nudge per zone with no extra indirection.
import "server-only";

import {
  clampBayTransform,
  isIdentityBayTransform,
  type BayTransform,
} from "@/lib/map/bay-transform";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "port-bay-transforms";

/** A stored nudge: the zone id it applies to, plus the four numbers. */
export type BayTransformRecord = { id: string } & BayTransform;

/**
 * Every zone's nudge, keyed by MapZone id, ready to hand to the map.
 *
 * Values are re-clamped on the way out, not trusted. Records are jsonb written
 * by a hand-rolled route; a row could predate a limit change, or carry a
 * non-finite number that a JSON round-trip turned into null. Clamping on read
 * as well as on write means a single bad row degrades to "this zone is not
 * nudged" instead of throwing coordinates off the map.
 */
export async function getBayTransforms(): Promise<Record<string, BayTransform>> {
  const rows = await readMerged<BayTransformRecord>(STORE, []);
  const out: Record<string, BayTransform> = {};
  for (const row of rows) {
    if (!row?.id) continue;
    const t = clampBayTransform(row);
    // Identity records carry no information; drop them so the payload the
    // client receives stays small and `Object.keys` means "actually nudged".
    if (!isIdentityBayTransform(t)) out[row.id] = t;
  }
  return out;
}

/**
 * Upsert one zone's nudge. Clamps before writing, so the stored value is always
 * within limits regardless of what the caller passed.
 *
 * An identity transform is PERSISTED rather than skipped: "reset this zone to
 * exactly as generated" has to overwrite the previous record, and writing the
 * explicit zeros is what makes that durable. `getBayTransforms` drops identities
 * on read, so the map still sees a clean payload.
 */
export async function saveBayTransform(
  zoneId: string,
  raw: unknown,
  meta?: WriteMeta,
): Promise<BayTransform> {
  const t = clampBayTransform(raw);
  await writeOverlayRecord<BayTransformRecord>(STORE, { id: zoneId, ...t }, meta);
  return t;
}
