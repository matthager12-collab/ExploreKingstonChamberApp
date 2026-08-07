// Cross-source dedupe (E12 pure core): the module that keeps July 4th on the
// calendar exactly once. The seed events were hand-copied FROM the same
// calendars ingest now reads, so near-identical pairs are the expected state,
// not an edge case.
//
// Four passes over the combined occurrence list:
//   0. admin "same event" verdicts — an explicit merge the matcher missed;
//   1. stable identities — same (source, externalId) on the same Pacific day
//      (occurrences of one series stay distinct), including identities the
//      survivor carries as aliases from earlier merges;
//   2. fuzzy — same normalized title AND same Pacific calendar date AND
//      (venue token overlap >= 1 OR either venue empty);
//   3. title CONTAINMENT — one normalized title is a contiguous token run
//      inside the other, at the same start instant and a compatible venue.
// Cluster survivor = highest SOURCE_PRECEDENCE (ADR-0002/ADR-0005 policy:
// in-app > ams-ical > tribe-*). The fuzzy thresholds and the precedence order
// encode Chamber policy — changing either after tests are green is ask-first.
//
// WHY PASS 3 (owner-approved threshold change, 2026-08-06). The AMS feed
// prefixes its titles with the town: "Kingston's Concerts On The Cove -
// Abracadabra Trip" against the curated "Concerts on the Cove: Abracadabra
// Trip". Pass 2 needs the normalized titles EQUAL, so every event carrying
// that prefix showed twice on /events. Containment is deliberately narrow
// rather than a similarity score: "Concerts on the Cove: Allswell" and
// "Concerts on the Cove: The Lumberjax" share four of six tokens and would
// merge under any Jaccard threshold loose enough to catch the prefix case,
// but neither is a token run inside the other, so containment leaves them
// alone. See the negative cases in tests/unit/events/dedupe.test.ts.
//
// Admin verdicts (event-overrides store) reference occurrenceKeys and come in
// both directions: "not a duplicate" pins a pair apart (honored transitively),
// "same event" forces a merge. A pinned-apart pair is never joined, including
// by a transitive chain of same-event verdicts — the explicit split wins.
// PURE: plain data in, plain data out.
//
// Delta 4 (RE-CHARTER): everything here is total over any SUBSET of sources —
// no pass, invariant, or tie-break requires an `ams-ical` (or any other)
// member to exist. Post-cancellation input (in-app + tribe only) is a
// first-class case with its own test.

import { pacificDateKey } from "./tz";
import { sourceRank, type EventSource, type NormalizedEvent } from "./types";

export type DedupeVerdict = "not-duplicate" | "same-event";

export interface DedupeOverride {
  keyA: string;
  keyB: string;
  verdict: DedupeVerdict;
}

export interface EventCluster {
  survivor: NormalizedEvent;
  /** Every member, survivor included, precedence order. */
  members: NormalizedEvent[];
}

/** Lowercase, strip diacritics and punctuation, drop leading articles,
 *  collapse whitespace — "The Kingston 4th of July Car Show!" and
 *  "kingston 4th of july car show" normalize identically. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/^(the|a|an)\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Venue words for the overlap check, normalized the same way. */
export function venueTokens(venue: string): string[] {
  const normalized = normalizeTitle(venue);
  return normalized ? normalized.split(" ") : [];
}

/**
 * The shorter title's tokens appear as a CONTIGUOUS RUN inside the longer's.
 *
 * "kingston s concerts on the cove abracadabra trip" contains "concerts on the
 * cove abracadabra trip"; "concerts on the cove the lumberjax" does not contain
 * "concerts on the cove allswell". Contiguity is what makes the difference —
 * a token-set overlap score cannot tell those two cases apart.
 */
export function titleContains(outer: string[], inner: string[]): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false;
  for (let start = 0; start + inner.length <= outer.length; start++) {
    let all = true;
    for (let k = 0; k < inner.length; k++) {
      if (outer[start + k] !== inner[k]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Floor on the contained title's length. Below this, containment stops being
 *  evidence: "market" sits inside "farmers market" and inside "night market",
 *  which are different events. Three tokens is the shortest run that reads as
 *  a name rather than a word. */
const MIN_CONTAINED_TOKENS = 3;

/** Pass 3's pair test: same start INSTANT (not merely the same day), a
 *  compatible venue, and one title contained in the other. Every clause is a
 *  narrowing one — this only ever merges pairs pass 2 already agreed are on
 *  the same day at a compatible place. */
function containmentMatch(a: NormalizedEvent, b: NormalizedEvent): boolean {
  if (new Date(a.startIso).getTime() !== new Date(b.startIso).getTime()) return false;
  if (!venuesCompatible(a, b)) return false;
  const ta = normalizeTitle(a.title).split(" ").filter(Boolean);
  const tb = normalizeTitle(b.title).split(" ").filter(Boolean);
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length < MIN_CONTAINED_TOKENS) return false;
  if (shorter.length === longer.length) return false; // pass 2's job
  return titleContains(longer, shorter);
}

function venuesCompatible(a: NormalizedEvent, b: NormalizedEvent): boolean {
  const ta = venueTokens(a.venue);
  const tb = venueTokens(b.venue);
  if (ta.length === 0 || tb.length === 0) return true;
  const set = new Set(ta);
  return tb.some((t) => set.has(t));
}

/** Union-find that refuses any union which would put an overridden pair in
 *  one cluster — the "not a duplicate" verdict, honored transitively. */
class Clusters {
  private parent: number[];
  private members: number[][];
  constructor(
    private events: NormalizedEvent[],
    private blockedPairs: Set<string>,
  ) {
    this.parent = events.map((_, i) => i);
    this.members = events.map((_, i) => [i]);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  private pairBlocked(a: number, b: number): boolean {
    const ka = this.events[a].occurrenceKey;
    const kb = this.events[b].occurrenceKey;
    return this.blockedPairs.has(ka < kb ? `${ka}\u0000${kb}` : `${kb}\u0000${ka}`);
  }
  union(i: number, j: number): void {
    const ri = this.find(i);
    const rj = this.find(j);
    if (ri === rj) return;
    // Cluster-level check: an admin verdict between ANY cross pair blocks the
    // whole merge, so C matching both A and B cannot re-join them.
    for (const a of this.members[ri]) {
      for (const b of this.members[rj]) {
        if (this.pairBlocked(a, b)) return;
      }
    }
    this.parent[rj] = ri;
    this.members[ri].push(...this.members[rj]);
    this.members[rj] = [];
  }
  groups(): number[][] {
    const byRoot = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      const g = byRoot.get(root) ?? [];
      g.push(i);
      byRoot.set(root, g);
    }
    return [...byRoot.values()];
  }
}

/** Deterministic precedence order inside a cluster: source rank, then source
 *  id, then externalId, then key — stable regardless of input order. */
function precedenceCompare(a: NormalizedEvent, b: NormalizedEvent): number {
  return (
    sourceRank(a.source) - sourceRank(b.source) ||
    a.source.localeCompare(b.source) ||
    a.externalId.localeCompare(b.externalId) ||
    a.occurrenceKey.localeCompare(b.occurrenceKey)
  );
}

function identityKeys(e: NormalizedEvent): string[] {
  const day = pacificDateKey(e.startIso);
  const ids = [
    `${e.source}:${e.externalId}`,
    ...(e.aliases ?? []).map((a) => `${a.source}:${a.externalId}`),
  ];
  return ids.map((id) => `${id}\u0000${day}`);
}

function buildClusters(
  events: NormalizedEvent[],
  overrides: DedupeOverride[],
): EventCluster[] {
  const blocked = new Set<string>();
  for (const o of overrides) {
    if (o.verdict !== "not-duplicate") continue;
    blocked.add(o.keyA < o.keyB ? `${o.keyA}\u0000${o.keyB}` : `${o.keyB}\u0000${o.keyA}`);
  }
  const clusters = new Clusters(events, blocked);

  // Pass 0 — admin "same event" verdicts: an explicit human merge for a pair
  // the matcher missed. Runs first because it is the strongest signal in the
  // input; union() still refuses any merge that would put a pinned-apart pair
  // in one cluster, so a "not a duplicate" verdict wins over a transitive
  // chain of these.
  const indexByKey = new Map<string, number>();
  events.forEach((e, i) => indexByKey.set(e.occurrenceKey, i));
  for (const o of overrides) {
    if (o.verdict !== "same-event") continue;
    const i = indexByKey.get(o.keyA);
    const j = indexByKey.get(o.keyB);
    // A verdict whose occurrences have aged out of the window is inert, not an
    // error: the store keeps it for when the pair comes round again.
    if (i !== undefined && j !== undefined) clusters.union(i, j);
  }

  // Pass 1 — stable identities.
  const byIdentity = new Map<string, number>();
  events.forEach((e, i) => {
    for (const key of identityKeys(e)) {
      const seen = byIdentity.get(key);
      if (seen === undefined) byIdentity.set(key, i);
      else clusters.union(seen, i);
    }
  });

  // Pass 2 — fuzzy: bucket by (normalized title, Pacific date), then the
  // venue-overlap check pairwise inside each bucket. Same title on a
  // DIFFERENT date never shares a bucket (weekly markets stay separate).
  const byTitleDate = new Map<string, number[]>();
  events.forEach((e, i) => {
    const title = normalizeTitle(e.title);
    if (!title) return; // nothing to match on
    const key = `${title}\u0000${pacificDateKey(e.startIso)}`;
    const bucket = byTitleDate.get(key) ?? [];
    bucket.push(i);
    byTitleDate.set(key, bucket);
  });
  for (const bucket of byTitleDate.values()) {
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        if (venuesCompatible(events[bucket[x]], events[bucket[y]])) {
          clusters.union(bucket[x], bucket[y]);
        }
      }
    }
  }

  // Pass 3 — containment. Buckets by DATE only, not (title, date): the whole
  // premise is that the two titles differ, so they cannot share pass 2's key.
  // A day's bucket is small (town-sized calendar), so the pairwise sweep is
  // cheap and stays proportional to what a single day actually holds.
  const byDate = new Map<string, number[]>();
  events.forEach((e, i) => {
    const key = pacificDateKey(e.startIso);
    const bucket = byDate.get(key) ?? [];
    bucket.push(i);
    byDate.set(key, bucket);
  });
  for (const bucket of byDate.values()) {
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        if (containmentMatch(events[bucket[x]], events[bucket[y]])) {
          clusters.union(bucket[x], bucket[y]);
        }
      }
    }
  }

  return clusters.groups().map((group) => {
    const members = group.map((i) => events[i]).sort(precedenceCompare);
    const survivor = members[0];
    // Survivor carries every merged identity so the NEXT ingest run's pass 1
    // resolves the same cluster without re-relying on the fuzzy pass.
    const aliases = new Map<string, { source: EventSource; externalId: string }>();
    for (const m of members) {
      aliases.set(`${m.source}:${m.externalId}`, {
        source: m.source,
        externalId: m.externalId,
      });
      for (const a of m.aliases ?? []) aliases.set(`${a.source}:${a.externalId}`, a);
    }
    aliases.delete(`${survivor.source}:${survivor.externalId}`);
    return {
      survivor:
        aliases.size > 0 ? { ...survivor, aliases: [...aliases.values()] } : survivor,
      members,
    };
  });
}

/** A pair the matcher did NOT merge, close enough that a human should look —
 *  the admin "possible duplicates" list. */
export interface DuplicateCandidate {
  a: NormalizedEvent;
  b: NormalizedEvent;
  /** Token overlap of the two normalized titles, 0..1. A sort key for the
   *  review list, never a merge decision. */
  score: number;
}

/**
 * Review threshold, deliberately LOOSER than anything that merges on its own.
 * The asymmetry is the point: a false candidate costs an admin one glance, a
 * false merge costs the town a missing event. Nothing on this list changes the
 * calendar until someone presses "Merge these".
 */
const CANDIDATE_MIN_SCORE = 0.4;

/** Jaccard overlap of the normalized title token SETS. Fine for ranking a
 *  review list; too blunt to merge on (see the containment note up top). */
function titleOverlap(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Same-day, venue-compatible pairs the merge left apart, ranked by title
 * overlap. Excludes pairs an admin has ALREADY ruled on in either direction —
 * a decided pair must not keep reappearing in the queue.
 */
export function candidatePairs(
  events: NormalizedEvent[],
  overrides: DedupeOverride[] = [],
  limit = 50,
): DuplicateCandidate[] {
  const clusterOf = new Map<string, number>();
  buildClusters(events, overrides).forEach((c, i) => {
    for (const m of c.members) clusterOf.set(m.occurrenceKey, i);
  });
  const ruled = new Set<string>();
  for (const o of overrides) {
    ruled.add(o.keyA < o.keyB ? `${o.keyA}\u0000${o.keyB}` : `${o.keyB}\u0000${o.keyA}`);
  }

  const byDate = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    const key = pacificDateKey(e.startIso);
    byDate.set(key, [...(byDate.get(key) ?? []), e]);
  }

  const out: DuplicateCandidate[] = [];
  for (const bucket of byDate.values()) {
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        const a = bucket[x];
        const b = bucket[y];
        if (clusterOf.get(a.occurrenceKey) === clusterOf.get(b.occurrenceKey)) continue;
        const ka = a.occurrenceKey;
        const kb = b.occurrenceKey;
        if (ruled.has(ka < kb ? `${ka}\u0000${kb}` : `${kb}\u0000${ka}`)) continue;
        if (!venuesCompatible(a, b)) continue;
        const score = titleOverlap(a.title, b.title);
        if (score < CANDIDATE_MIN_SCORE) continue;
        out.push({ a, b, score });
      }
    }
  }
  return out
    .sort((p, q) => q.score - p.score || p.a.occurrenceKey.localeCompare(q.a.occurrenceKey))
    .slice(0, limit);
}

/** Clusters with more than one member — the admin dedupe-review list. */
export function reviewClusters(
  events: NormalizedEvent[],
  overrides: DedupeOverride[],
): EventCluster[] {
  return buildClusters(events, overrides).filter((c) => c.members.length > 1);
}

/**
 * THE merge: cluster, pick survivors by precedence, sort by start then title.
 * Total over any subset of sources (delta 4) — an input with no ams-ical
 * events (the post-cancellation world) merges identically minus that source.
 */
export function mergeCalendar(
  events: NormalizedEvent[],
  overrides: DedupeOverride[] = [],
): NormalizedEvent[] {
  return buildClusters(events, overrides)
    .map((c) => c.survivor)
    .sort(
      (a, b) => a.startIso.localeCompare(b.startIso) || a.title.localeCompare(b.title),
    );
}
