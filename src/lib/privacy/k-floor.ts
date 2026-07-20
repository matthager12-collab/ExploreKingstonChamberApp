// E11 k-anonymity floor. Generic collapse of aggregate buckets that contain
// fewer than k DISTINCT SESSIONS: small-town counts of 1 are re-identifiable
// ("someone was at the marina at 7am" + a named area = a person), so no
// published aggregate may surface a bucket below the floor. Applied inside
// summarize() so every consumer — the admin dashboard, future exports, E18's
// LTAC reporting — inherits it; never bolt it on at a render site.
//
// The k value itself lives in policy.ts (K_FLOOR) — it is a Chamber-visible
// number, not a tuning parameter.

/**
 * Partition `rows` by the floor: buckets with sessionsOf(row) >= k keep
 * their position and order; everything below collapses into ONE row built by
 * `makeCollapsed` (which must preserve totals — sum counts, union session
 * sets), appended LAST so it never wins a "top bucket" slot. No below-floor
 * rows -> no collapsed row (never render an empty rollup).
 */
export function applyKFloor<T>(
  rows: readonly T[],
  k: number,
  sessionsOf: (row: T) => number,
  makeCollapsed: (below: readonly T[]) => T,
): T[] {
  const keep: T[] = [];
  const below: T[] = [];
  for (const row of rows) {
    (sessionsOf(row) >= k ? keep : below).push(row);
  }
  if (below.length === 0) return keep;
  return [...keep, makeCollapsed(below)];
}
