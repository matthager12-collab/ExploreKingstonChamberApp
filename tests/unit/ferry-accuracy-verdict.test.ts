// The go/no-go readout on /admin/ferry-info decides whether the busyness
// prediction gets shown to visitors, so its thresholds are pinned here rather
// than left to drift inside JSX. The "prod-like" case uses the real numbers the
// backtest was reporting on 2026-07-31 (n=11,623 over 27 days, level match
// 0.23, bias +19.9) — that has to read as "not ready", or the panel is lying.

import { describe, expect, it } from "vitest";
import {
  accuracyVerdict,
  plateauDays,
  type VerdictInput,
  type VerdictSeriesPoint,
} from "@/lib/ferry-accuracy-verdict";

const base: VerdictInput = {
  n: 5_000,
  mae: 12,
  bias: 2,
  levelMatchRate: 0.7,
  within1Rate: 0.92,
  spanDays: 20,
};

/** A series whose cumulative MAE holds at `settled` for the last `flat` days. */
function series(values: number[]): VerdictSeriesPoint[] {
  return values.map((mae) => ({ cumulative: { mae } }));
}

describe("plateauDays", () => {
  it("counts the trailing run within tolerance of the final value", () => {
    // 40, 36 are >1 away from the final 33 — the run is the last four.
    expect(plateauDays(series([40, 36, 33.5, 33.2, 32.8, 33]))).toBe(4);
  });

  it("counts the whole series when it never moves", () => {
    expect(plateauDays(series([33, 33, 33]))).toBe(3);
  });

  it("counts only the last point when the previous one jumped", () => {
    expect(plateauDays(series([33, 33, 20]))).toBe(1);
  });

  it("is 0 for an empty series", () => {
    expect(plateauDays([])).toBe(0);
  });
});

describe("accuracyVerdict", () => {
  it("reports unknown with no metrics at all", () => {
    expect(accuracyVerdict(null).tone).toBe("unknown");
    expect(accuracyVerdict({ ...base, n: 0 }).tone).toBe("unknown");
  });

  it("holds off judging until a full week of coverage", () => {
    // Plenty of readings, but only three days — demand is weekly, so this is
    // deliberately NOT enough to call.
    const v = accuracyVerdict({ ...base, n: 4_000, spanDays: 3 });
    expect(v.tone).toBe("unknown");
    expect(v.headline).toBe("Too early to judge");
  });

  it("holds off judging on a thin sample even across many days", () => {
    expect(accuracyVerdict({ ...base, n: 40, spanDays: 30 }).tone).toBe("unknown");
  });

  it("calls a well-centered, accurate model ready", () => {
    const v = accuracyVerdict(base);
    expect(v.tone).toBe("ready");
    expect(v.detail).toContain("70%");
  });

  it("calls the real 2026-07-31 production numbers NOT ready", () => {
    const v = accuracyVerdict(
      { n: 11_623, mae: 32.8, bias: 19.9, levelMatchRate: 0.23, within1Rate: 0.57, spanDays: 27 },
      series([35.6, 35.1, 34.2, 33.7, 34, 33.9, 33.3, 33, 32.8, 32.8, 32.6, 33.1, 33.3, 33, 32.7, 32.8]),
    );
    expect(v.tone).toBe("not-ready");
    expect(v.headline).toBe("Not ready to turn on");
    expect(v.detail).toContain("23%");
    expect(v.detail).toContain("19.9 points high");
    // The plateau run is long here, so it must say more data won't fix it.
    expect(v.detail).toContain("won't change it");
  });

  it("stays quiet about the plateau when the number is still moving", () => {
    const v = accuracyVerdict(
      { n: 11_623, mae: 32.8, bias: 19.9, levelMatchRate: 0.23, within1Rate: 0.57, spanDays: 27 },
      series([60, 55, 48, 40, 32.8]), // still dropping fast — only 1 day settled
    );
    expect(v.tone).toBe("not-ready");
    expect(v.detail).not.toContain("won't change it");
  });

  it("calls a middling model borderline", () => {
    const v = accuracyVerdict({ ...base, levelMatchRate: 0.5, bias: 6, within1Rate: 0.8 });
    expect(v.tone).toBe("borderline");
  });

  it("demotes an otherwise-accurate model that is systematically skewed", () => {
    // Right level often enough, but consistently 20 points high: wrong the same
    // way every time is the failure visitors actually notice.
    const v = accuracyVerdict({ ...base, levelMatchRate: 0.7, bias: 20 });
    expect(v.tone).toBe("not-ready");
    expect(v.detail).toContain("over-predicting");
  });

  it("names the direction of a low-running skew", () => {
    const v = accuracyVerdict({ ...base, levelMatchRate: 0.7, bias: -20 });
    expect(v.detail).toContain("20 points low");
    expect(v.detail).toContain("under-predicting");
  });

  it("holds ready models to the within-one-level bound too", () => {
    // Exact match is fine but the misses are wild — not ready.
    const v = accuracyVerdict({ ...base, levelMatchRate: 0.7, bias: 1, within1Rate: 0.6 });
    expect(v.tone).toBe("borderline");
  });
});
