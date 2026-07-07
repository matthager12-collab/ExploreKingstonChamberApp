// Characterization tests for the ferry busyness model (src/lib/ferry-forecast.ts)
// and its boarding-pass twin (src/lib/wsf.ts getBoardingPassStatus).
//
// These freeze the model's behavior AS IT IS TODAY (SDD §14 item 4 + the
// ferry-audit drift traps): the 0..100 score scale, the score->level bands, the
// empirical-blend gate, the holiday-exclusion carve-out, and — the single most
// important trap — that forecastAt().boardingPassActive stays byte-for-byte in
// step with getBoardingPassStatus().active across every hour probed all year.
//
// All Date construction is timezone-anchored via pacificWallTimeToISO so the
// suite is stable regardless of the runner's TZ.

import { describe, expect, it } from "vitest";
import {
  scoreAt,
  scoreToLevel,
  dayCurve,
  forecastAt,
  empiricalBucketKey,
  EMP_MIN_SAMPLES,
  hhmmToMinutes,
  minutesToHhmm,
  type EmpiricalTable,
} from "@/lib/ferry-forecast";
import { getBoardingPassStatus } from "@/lib/wsf";
import { pacificWallTimeToISO } from "@/lib/time";
import type { Direction } from "@/lib/types";

const DIRECTIONS: Direction[] = ["from-kingston", "to-kingston"];

describe("scoreToLevel band edges", () => {
  // The private thresholds are: <20 light, <42 moderate, <65 busy,
  // <83 very-busy, else extreme. Probe each boundary from both sides.
  it("classifies just below and at/above every threshold", () => {
    // light | moderate boundary at 20
    expect(scoreToLevel(0)).toBe("light");
    expect(scoreToLevel(19)).toBe("light");
    expect(scoreToLevel(20)).toBe("moderate");

    // moderate | busy boundary at 42
    expect(scoreToLevel(41)).toBe("moderate");
    expect(scoreToLevel(42)).toBe("busy");

    // busy | very-busy boundary at 65
    expect(scoreToLevel(64)).toBe("busy");
    expect(scoreToLevel(65)).toBe("very-busy");

    // very-busy | extreme boundary at 83
    expect(scoreToLevel(82)).toBe("very-busy");
    expect(scoreToLevel(83)).toBe("extreme");
    expect(scoreToLevel(100)).toBe("extreme");
  });
});

describe("scoreAt is an integer busyness score in [0,100]", () => {
  // A grid of dates spanning off/shoulder/peak season + holidays, several
  // times across the day, both directions. Every score must be a clamped,
  // rounded integer on the 0..100 busyness scale (NOT a 0..1 probability).
  const dates = [
    "2026-01-15", // deep off-season weekday
    "2026-05-23", // Memorial Day weekend Saturday (shoulder + holiday)
    "2026-07-04", // Independence Day (peak + worst holiday)
    "2026-07-06", // peak-season Monday
    "2026-08-15", // peak Saturday
    "2026-10-04", // shoulder Sunday
    "2026-12-25", // holiday-week Friday
  ];
  it("returns Number.isInteger scores within 0..100 across the grid", () => {
    let checked = 0;
    for (const dateStr of dates) {
      for (let minutes = 0; minutes <= 24 * 60; minutes += 37) {
        for (const dir of DIRECTIONS) {
          const s = scoreAt(dateStr, minutes, dir);
          expect(Number.isInteger(s)).toBe(true);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(100);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });
});

describe("empiricalBucketKey GOLDEN string", () => {
  // GOLDEN: the bucket key format is a shared contract between the forecast
  // model and the server-side observation aggregator (stores/ferry-observations).
  // If this string format ever changes, EVERY empirical bucket collected in
  // production is orphaned — the model would look up new-format keys and never
  // find the old-format data, silently discarding all accumulated observations.
  // 2026-07-06 is a Monday (dow=1); doy 706 is peak season; 480 min = hour 8.
  it("emits direction|season|dow|hour for a fixed input", () => {
    expect(empiricalBucketKey("from-kingston", "2026-07-06", 480)).toBe(
      "from-kingston|peak|1|8",
    );
  });

  it("season-scopes the key (off-season winter, different weekday/hour)", () => {
    // 2026-01-19 is a Monday (dow=1); doy 119 is off-season; 915 min = hour 15.
    expect(empiricalBucketKey("to-kingston", "2026-01-19", 915)).toBe(
      "to-kingston|off|1|15",
    );
  });
});

describe("empirical blend gate", () => {
  // Non-holiday peak weekday so the empirical branch is reachable.
  const dateStr = "2026-07-06"; // Monday, peak
  const minutes = 480; // hour 8
  const dir: Direction = "from-kingston";
  const key = empiricalBucketKey(dir, dateStr, minutes);
  const prior = scoreAt(dateStr, minutes, dir); // no empirical

  it("ignores a bucket with n < EMP_MIN_SAMPLES", () => {
    const lowN: EmpiricalTable = {
      [key]: { s: 100, n: EMP_MIN_SAMPLES - 1 },
    };
    // Below the sample floor the bucket is too noisy to trust: score is
    // identical to the no-empirical heuristic.
    expect(scoreAt(dateStr, minutes, dir, lowN)).toBe(prior);
  });

  it("moves the score for a high-n bucket, staying an integer in [0,100]", () => {
    // A well-observed bucket pulling hard toward 100 must shift the blended
    // score away from the prior (characterize, don't re-derive the formula).
    const highN: EmpiricalTable = {
      [key]: { s: 100, n: 200 },
    };
    const blended = scoreAt(dateStr, minutes, dir, highN);
    expect(Number.isInteger(blended)).toBe(true);
    expect(blended).toBeGreaterThanOrEqual(0);
    expect(blended).toBeLessThanOrEqual(100);
    expect(blended).not.toBe(prior);
    // The observation is higher than the prior, so the blend rises toward it.
    expect(blended).toBeGreaterThan(prior);
  });

  it("mirrors the gate in forecastAt.empiricalApplied / empiricalSamples", () => {
    const lowN: EmpiricalTable = { [key]: { s: 100, n: EMP_MIN_SAMPLES - 1 } };
    const highN: EmpiricalTable = { [key]: { s: 100, n: 200 } };

    const noData = forecastAt(dateStr, minutes, dir, "drive");
    expect(noData.empiricalApplied).toBe(false);
    expect(noData.empiricalSamples).toBe(0);

    const belowFloor = forecastAt(dateStr, minutes, dir, "drive", lowN);
    expect(belowFloor.empiricalApplied).toBe(false);
    expect(belowFloor.empiricalSamples).toBe(0);

    const applied = forecastAt(dateStr, minutes, dir, "drive", highN);
    expect(applied.empiricalApplied).toBe(true);
    expect(applied.empiricalSamples).toBe(200);
  });
});

describe("holiday exclusion from the empirical blend", () => {
  // On July 4 (peak + the worst holiday) the blend is skipped: holiday spikes
  // are rare, so a bucket average (mostly ordinary days) would wash them out.
  const dateStr = "2026-07-04"; // Saturday, Independence Day
  const minutes = 480; // hour 8
  const dir: Direction = "from-kingston";
  const key = empiricalBucketKey(dir, dateStr, minutes);

  it("leaves the score unchanged even with a high-n bucket", () => {
    const prior = scoreAt(dateStr, minutes, dir);
    const highN: EmpiricalTable = { [key]: { s: 5, n: 200 } };
    // A strong low-busyness observation would drag the score down if applied;
    // it must not, because the holiday branch bypasses the blend entirely.
    expect(scoreAt(dateStr, minutes, dir, highN)).toBe(prior);
  });

  it("reports empiricalApplied === false via forecastAt on the holiday", () => {
    const highN: EmpiricalTable = { [key]: { s: 5, n: 200 } };
    const f = forecastAt(dateStr, minutes, dir, "drive", highN);
    expect(f.empiricalApplied).toBe(false);
    expect(f.empiricalSamples).toBe(0);
  });
});

describe("dayCurve", () => {
  // Operating window is 5:00 (300 min) to 24:00 (1440 min).
  const DAY_START_MIN = 5 * 60;
  const DAY_END_MIN = 24 * 60;

  it("keeps all points within the day window with scores in [0,100]", () => {
    const { points, quietest, busiest } = dayCurve("2026-08-15", "to-kingston");
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.minutes).toBeGreaterThanOrEqual(DAY_START_MIN);
      expect(p.minutes).toBeLessThanOrEqual(DAY_END_MIN);
      expect(Number.isInteger(p.score)).toBe(true);
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      expect(p.level).toBe(scoreToLevel(p.score));
    }
    // Extremes are drawn from the same point set and ordered sensibly.
    expect(quietest.score).toBeLessThanOrEqual(busiest.score);
    expect(quietest.startMin).toBeGreaterThanOrEqual(DAY_START_MIN);
    expect(busiest.endMin).toBeLessThanOrEqual(DAY_END_MIN);
  });
});

describe("BOARDING-PASS PARITY (the #1 drift trap)", () => {
  // forecastAt().boardingPassActive is a hand-maintained mirror of
  // getBoardingPassStatus().active. They live in two different files
  // (ferry-forecast.ts boardingPassExpected vs wsf.ts getBoardingPassStatus)
  // and MUST agree. Probe every calendar day of 2026 at Pacific hours that
  // straddle the peak-hours edges {7 (before), 8 (start), 13 (mid), 19 (last),
  // 20 (after)} — ~1825 paired assertions, all in-memory.
  it("agrees for every day of 2026 at hours {7,8,13,19,20}", () => {
    const hours = [7, 8, 13, 19, 20];
    let compared = 0;
    let disagreements = 0;
    const start = new Date(Date.UTC(2026, 0, 1));
    const end = new Date(Date.UTC(2026, 11, 31));
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const dateStr = `${y}-${mo}-${day}`;
      for (const h of hours) {
        const hhmm = `${String(h).padStart(2, "0")}:00`;
        const wsf = getBoardingPassStatus(
          new Date(pacificWallTimeToISO(dateStr, hhmm)),
        ).active;
        const model = forecastAt(
          dateStr,
          h * 60,
          "from-kingston",
          "drive",
        ).boardingPassActive;
        if (wsf !== model) disagreements++;
        compared++;
      }
    }
    expect(disagreements).toBe(0);
    // Sanity: we really did run the ~365*5 comparisons, not zero.
    expect(compared).toBe(365 * 5);
  });
});

describe("hhmmToMinutes / minutesToHhmm round-trip", () => {
  it("round-trips several well-formed 24h times", () => {
    const times = ["00:00", "05:00", "06:25", "12:30", "14:30", "20:45", "23:59"];
    for (const t of times) {
      expect(minutesToHhmm(hhmmToMinutes(t))).toBe(t);
    }
  });

  it("hhmmToMinutes computes minutes since midnight", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("06:25")).toBe(6 * 60 + 25);
    expect(hhmmToMinutes("23:59")).toBe(23 * 60 + 59);
  });

  it("minutesToHhmm wraps and pads", () => {
    expect(minutesToHhmm(0)).toBe("00:00");
    expect(minutesToHhmm(1440)).toBe("00:00"); // wraps at a full day
    expect(minutesToHhmm(-60)).toBe("23:00"); // negative wraps forward
  });
});
