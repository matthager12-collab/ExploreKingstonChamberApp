// Seed-vs-overlay comparison — the pure half of the "never shadow the shipped
// version for nothing" rule (see writeOverlayRecordSeedAware in json-store.ts).
//
// Background: every seeded domain reads as seed + overlay, overlay-wins-by-id.
// An overlay row therefore DETACHES its record from the codebase permanently:
// later edits to the seed file can never surface again. On 2026-08-19 that bit
// us for real — PR #194 fixed factual errors in two itineraries, CI passed, the
// deploy shipped, and the live pages kept serving the old text because someone
// had once opened those records in the builder and pressed Save without editing
// anything. A no-op save is indistinguishable from a real one at the store
// layer, so it wrote a row, and the row won forever.
//
// Why canonicalize rather than compare directly: the same content reaches us in
// three different key orders — the seed is a TypeScript object literal, a
// submission is a zod parse result, and a stored doc has been through JSONB
// (which preserves neither key order nor `undefined`). Arrays are deliberately
// NOT sorted: itinerary stop order is content, not representation.

export type WithId = { id: string };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      // JSONB drops undefined on the way in, so a seed that carries an
      // explicit `undefined` must still read as equal to the stored doc.
      if (source[key] === undefined) continue;
      out[key] = canonical(source[key]);
    }
    return out;
  }
  return value;
}

/** Content equality that survives a JSONB round-trip and key reordering. */
export function sameDoc(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * True when saving `record` would write an overlay row that says nothing the
 * shipped seed doesn't already say.
 *
 * Deliberately NOT a no-op, because each is a real decision the seed cannot
 * express on its own:
 *  - a tombstone (`_deleted`) — hiding a seed record is a choice;
 *  - a record with no seed twin — nothing to fall back to;
 *  - anything the caller is writing at a non-live status — that is the E08
 *    moderation flow, and it is handled by the caller (see
 *    writeOverlayRecordSeedAware), not here.
 */
export function isSeedNoop<T extends WithId>(
  seed: readonly T[],
  record: (T & { _deleted?: boolean }) | null | undefined,
): boolean {
  if (!record || record._deleted) return false;
  const twin = seed.find((s) => s.id === record.id);
  if (!twin) return false;
  const { _deleted: _ignored, ...doc } = record as { _deleted?: boolean } & Record<
    string,
    unknown
  >;
  return sameDoc(doc, twin);
}
