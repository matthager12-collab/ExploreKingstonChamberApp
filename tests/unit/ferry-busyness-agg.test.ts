// Equivalence tests for the memoized pacificParts + hoisted Intl formatters in
// stores/ferry-observations (the /ferry cold-render fix): the optimized path
// must be BYTE-IDENTICAL to the naive one that constructed fresh
// Intl.DateTimeFormat instances on every call. The reference implementations
// here ARE that naive path — if the memo/hoist ever drifts (wrong cache key,
// stale entry, formatter reuse bug), these suites catch it.
//
// DST is the scary case for a shared formatter + cache, so the probe instants
// deliberately straddle both America/Los_Angeles transitions (spring-forward
// 2026-03-08, fall-back 2026-11-01). All instants are absolute UTC ISO strings,
// so the suite is stable regardless of the runner's TZ.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { appendFerryObservation } from "@/lib/db/append";
import * as append from "@/lib/db/append";
import { ferryObservation } from "@/lib/db/schema";
import {
  computeAccuracy,
  getEmpiricalBusyness,
  pacificParts,
  recordSailingSpaceSnapshot,
  type FerryObservation,
} from "@/lib/stores/ferry-observations";
import { empiricalBucketKey, type EmpiricalTable } from "@/lib/ferry-forecast";
import type { Direction } from "@/lib/types";

const TZ = "America/Los_Angeles";

/** The un-memoized original: two fresh Intl.DateTimeFormat instances per call. */
function referencePacificParts(iso: string): { date: string; minutes: number } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (x: string) => Number(t.find((p) => p.type === x)?.value ?? 0);
  return { date, minutes: get("hour") * 60 + get("minute") };
}

// Probe instants: dense 7-minute sweeps across both 2026 DST transitions
// (02:00 PST → 03:00 PDT at 10:00 UTC on 2026-03-08; 02:00 PDT → 01:00 PST at
// 09:00 UTC on 2026-11-01), plus a coarse sweep across the whole year.
function buildProbeInstants(): string[] {
  const instants: string[] = [];
  for (const startUtc of [Date.UTC(2026, 2, 8, 7, 0), Date.UTC(2026, 10, 1, 6, 0)]) {
    for (let m = 0; m <= 6 * 60; m += 7) instants.push(new Date(startUtc + m * 60_000).toISOString());
  }
  for (let i = 0; i < 260; i++) {
    instants.push(new Date(Date.UTC(2026, 0, 1, 0, 13) + i * 33.5 * 3_600_000).toISOString());
  }
  return instants;
}

describe("pacificParts memoization equivalence", () => {
  it("matches fresh-formatter output across DST boundaries, including cache hits", () => {
    const instants = buildProbeInstants();
    expect(instants.length).toBeGreaterThan(300);
    for (const iso of instants) {
      expect(pacificParts(iso)).toEqual(referencePacificParts(iso)); // cold (first sight)
      expect(pacificParts(iso)).toEqual(referencePacificParts(iso)); // warm (memo hit)
    }
  });
});

// ---- End-to-end: getEmpiricalBusyness vs a fresh-formatter reference --------

/** Reference aggregation: getEmpiricalBusyness's exact math, naive pacificParts. */
function referenceAggregate(observations: FerryObservation[]): {
  table: EmpiricalTable;
  sampleCount: number;
  days: number;
} {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const acc = new Map<string, { sumFull: number; nFull: number; sumDelay: number; nDelay: number }>();
  const days = new Set<string>();
  let sampleCount = 0;
  for (const o of observations) {
    const at = referencePacificParts(o.departs);
    const key = empiricalBucketKey(o.dir, at.date, at.minutes);
    const entry = acc.get(key) ?? { sumFull: 0, nFull: 0, sumDelay: 0, nDelay: 0 };
    if (typeof o.max === "number" && o.max > 0 && typeof o.driveUp === "number" && o.driveUp >= 0) {
      entry.sumFull += clamp01(1 - o.driveUp / o.max) * 100;
      entry.nFull += 1;
      sampleCount += 1;
    }
    if (typeof o.delayMin === "number" && o.delayMin > 0) {
      entry.sumDelay += o.delayMin;
      entry.nDelay += 1;
    }
    acc.set(key, entry);
    days.add(referencePacificParts(o.ts).date);
  }
  const table: EmpiricalTable = {};
  for (const [key, e] of acc) {
    if (e.nFull === 0) continue;
    const meanFull = e.sumFull / e.nFull;
    const delayBoost = e.nDelay > 0 ? (Math.min(e.sumDelay / e.nDelay, 30) / 30) * 12 : 0;
    table[key] = { s: Math.max(0, Math.min(100, Math.round(meanFull + delayBoost))), n: e.nFull };
  }
  return { table, sampleCount, days: days.size };
}

/** Deterministic synthetic log: sailings on DST-transition days (and their
 *  neighbors, plus two peak-summer days), several snapshots per sailing so
 *  `departs` repeats (the memo's hot path), WSF null gaps, zero and positive
 *  delays. */
function buildSyntheticObservations(): FerryObservation[] {
  const observations: FerryObservation[] = [];
  // UTC anchors chosen so DST-day sailings depart inside/around the local
  // transition window (09:00–11:00 UTC ≈ the 01:00–03:00 Pacific mess).
  const dayAnchorsUtc = [
    Date.UTC(2026, 2, 7, 9, 30), // day before spring-forward
    Date.UTC(2026, 2, 8, 9, 30), // spring-forward day, mid-transition
    Date.UTC(2026, 2, 9, 9, 30), // day after
    Date.UTC(2026, 9, 31, 8, 30), // day before fall-back
    Date.UTC(2026, 10, 1, 8, 30), // fall-back day, mid-transition
    Date.UTC(2026, 10, 2, 8, 30), // day after
    Date.UTC(2026, 6, 4, 17, 30), // peak Saturday (holiday)
    Date.UTC(2026, 7, 15, 22, 10), // peak Saturday evening
  ];
  const dirs: Direction[] = ["from-kingston", "to-kingston"];
  let seq = 0;
  for (const anchor of dayAnchorsUtc) {
    for (const dir of dirs) {
      for (let sailing = 0; sailing < 3; sailing++) {
        const departsMs = anchor + sailing * 95 * 60_000; // ~1.6h apart, crossing the transition
        const departs = new Date(departsMs).toISOString();
        for (let snap = 0; snap < 6; snap++) {
          const ts = new Date(departsMs - (110 - snap * 10) * 60_000).toISOString();
          seq++;
          const gap = seq % 4 === 0; // WSF not reporting
          observations.push({
            ts,
            dir,
            departs,
            driveUp: gap ? null : Math.max(0, 120 - snap * 17 - (seq % 23)),
            max: gap ? null : 120,
            // Mix: positive delays count, zeros and nulls must not.
            delayMin: seq % 5 === 0 ? 8 + (seq % 11) : seq % 5 === 1 ? 0 : null,
          });
        }
      }
    }
  }
  return observations;
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

describe("getEmpiricalBusyness with memoized pacificParts", () => {
  const recent = buildSyntheticObservations();
  // A usable-fullness row appended ~200 days ago (DB ts, i.e. before the
  // retention cutoff): the busyness aggregate must NOT scan it, the accuracy
  // backtest must still see the full log.
  const stale: FerryObservation = {
    ts: "2026-01-05T18:00:00.000Z",
    dir: "from-kingston",
    departs: "2026-01-05T19:10:00.000Z",
    driveUp: 30,
    max: 120,
    delayMin: 5,
  };

  it("is byte-identical to the fresh-formatter reference aggregation", async () => {
    for (const obs of recent) await appendFerryObservation(obs);
    await tdb.db
      .insert(ferryObservation)
      .values({ ts: new Date(Date.now() - 200 * 24 * 3_600_000), obs: stale });

    const result = await getEmpiricalBusyness();
    const ref = referenceAggregate(recent); // stale row excluded by the scan bound

    expect(result.table).toEqual(ref.table);
    expect(result.sampleCount).toBe(ref.sampleCount);
    expect(result.days).toBe(ref.days);
    expect(Object.keys(result.table).length).toBeGreaterThan(10); // non-trivial spread
  });

  it("accuracy backtest still reads the full log (no cutoff)", async () => {
    const usable = (o: FerryObservation) =>
      typeof o.max === "number" && o.max > 0 && typeof o.driveUp === "number" && o.driveUp >= 0;
    const metrics = await computeAccuracy();
    expect(metrics.n).toBe([...recent, stale].filter(usable).length);
  });
});

// ---- Cache behavior: SWR + single-flight, snapshot writes no longer clear it

describe("getEmpiricalBusyness cache: stale-while-revalidate + single-flight", () => {
  it("a snapshot write no longer invalidates a fresh aggregate cache", async () => {
    await getEmpiricalBusyness(); // warm (already warm from the describe block above; harmless)

    const spy = vi.spyOn(append, "readFerryObservations");
    try {
      // driveUpSpaces/maxSpaces null (WSF "not reporting") so this write can't
      // change any fullness-derived count elsewhere in the file.
      const sampleSpace = {
        kingston: [
          { departs: new Date(Date.now() + 20 * 60_000).toISOString(), vessel: "Test", driveUpSpaces: null, maxSpaces: null },
        ],
        edmonds: [
          { departs: new Date(Date.now() + 25 * 60_000).toISOString(), vessel: "Test", driveUpSpaces: null, maxSpaces: null },
        ],
      };
      const wrote = await recordSailingSpaceSnapshot(sampleSpace, { toKingston: 0, fromKingston: 0 });
      expect(wrote).toBe(true);

      await getEmpiricalBusyness(); // still within TTL — must not rescan
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("cold cache: two concurrent calls share one scan", async () => {
    // The shared module-level aggCache above is already warm by this point in
    // the file (by design — writes no longer clear it), so a genuinely cold
    // cache needs its own module instance: reset the registry and re-import,
    // rewiring the fresh db/client seam to the same test database.
    vi.resetModules();
    try {
      const client = await import("@/lib/db/client");
      client.__setDbForTests(tdb.db);
      const freshAppend = await import("@/lib/db/append");
      const freshStore = await import("@/lib/stores/ferry-observations");

      const spy = vi.spyOn(freshAppend, "readFerryObservations");
      try {
        const [a, b] = await Promise.all([
          freshStore.getEmpiricalBusyness(),
          freshStore.getEmpiricalBusyness(),
        ]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
      } finally {
        spy.mockRestore();
      }
    } finally {
      vi.resetModules();
    }
  });
});
