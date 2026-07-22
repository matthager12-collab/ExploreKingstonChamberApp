// E15 follow-up — the percentile that the Chamber's "are we fast enough?"
// answer is computed from.
//
// p75 is load-bearing: it is the number on the admin dashboard, it is the
// number compared against NFR-1's 2500ms, and it is the number that decides
// whether anyone spends a sprint on performance. A percentile that is subtly
// wrong is worse than no percentile, because it looks authoritative.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAnalyticsEvent } from "@/lib/db/append";
import {
  percentile75,
  summarize,
  WEB_VITAL_MIN_SAMPLES,
  WEB_VITAL_SPECS,
  type WebVitalMetric,
} from "@/lib/analytics-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

describe("percentile75", () => {
  it("returns 0 for an empty sample rather than NaN", () => {
    // A NaN here would render as "NaNs" on the dashboard and poison any
    // downstream comparison — every threshold check against NaN is false.
    expect(percentile75([])).toBe(0);
  });

  it("returns the only value for a single sample", () => {
    expect(percentile75([1234])).toBe(1234);
  });

  it("uses NEAREST-RANK, so the result is always a value a visitor really saw", () => {
    // 1..100: the 75th percentile by nearest rank is ceil(0.75*100) = 75th
    // smallest = 75. An interpolating percentile would return 75.25, a timing
    // no visitor experienced.
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile75(values)).toBe(75);
  });

  it("is order-independent (callers append in arrival order, not sorted)", () => {
    const a = [500, 100, 4000, 250, 900];
    const b = [4000, 900, 500, 250, 100];
    expect(percentile75(a)).toBe(percentile75(b));
  });

  it("does not mutate the caller's array", () => {
    // summarize() reuses these buckets (LCP feeds both the overall row and the
    // per-path breakdown), so an in-place sort would corrupt the second read.
    const values = [3000, 1000, 2000];
    const copy = [...values];
    percentile75(values);
    expect(values).toEqual(copy);
  });

  it("exposes a slow tail that the median reports as healthy", () => {
    // 7 fast loads, 3 miserable ones — i.e. 30% of real visits are bad.
    // The MEDIAN says 500ms and everything is fine. p75 says 4000ms, which is
    // the truth for the slowest quarter and the reason the Core Web Vitals
    // standard picked this percentile instead of the median.
    const values = [500, 500, 500, 500, 500, 500, 500, 4000, 4000, 4000];
    expect(percentile75(values)).toBe(4000);
    // Guard the framing above: the median really is the reassuring number.
    const sorted = [...values].sort((a, b) => a - b);
    expect((sorted[4] + sorted[5]) / 2).toBe(500);
  });
});

function vital(metric: WebVitalMetric, value: number, path: string, sessionId: string) {
  return appendAnalyticsEvent({
    ts: new Date().toISOString(),
    type: "webvital",
    path,
    sessionId,
    geo: { source: "dbip" },
    metric,
    value,
  });
}

describe("summarize() web vitals (mixed dataset)", () => {
  let tdb: TestDb;

  beforeAll(async () => {
    tdb = await createTestDb();
    // "/" gets 12 LCP samples (clears the min): 1000..2100 rising by 100.
    for (let i = 0; i < 12; i++) await vital("LCP", 1000 + i * 100, "/", `s-home-${i}`);
    // "/ferry" is genuinely slow — 10 samples clustered high.
    for (let i = 0; i < 10; i++) await vital("LCP", 4200 + i * 50, "/ferry", `s-ferry-${i}`);
    // "/eat" has only 3 samples — under the floor, must not be reported.
    for (let i = 0; i < 3; i++) await vital("LCP", 9000, "/eat", `s-eat-${i}`);
    // A malformed legacy-ish row: no metric/value. Must not crash or count.
    await appendAnalyticsEvent({
      ts: new Date().toISOString(),
      type: "webvital",
      path: "/",
      sessionId: "s-broken",
      geo: { source: "unknown" },
    });
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("reports p75 per metric and rates it against the published threshold", async () => {
    const summary = await summarize();
    const lcp = summary.webVitals.find((v) => v.metric === "LCP");

    // 25 well-formed LCP rows (12 + 10 + 3); the malformed one is ignored,
    // not counted. Note "/eat"'s 3 samples DO count here even though they are
    // hidden from the per-path table below: the sample floor is about whether
    // a single PAGE's percentile is trustworthy, not about excluding those
    // loads from the site-wide number. They really did happen to someone.
    expect(lcp?.samples).toBe(25);
    expect(lcp?.reportable).toBe(true);
    // Mixed fast "/" and slow "/ferry": p75 lands in the slow cluster, which
    // is exactly the point — a median would have reported the fast half.
    expect(lcp?.p75).toBeGreaterThan(WEB_VITAL_SPECS.LCP.poor);
    expect(lcp?.rating).toBe("poor");
  });

  it("emits a row for every metric even with zero samples", async () => {
    const summary = await summarize();
    // A missing row reads as "we forgot to measure"; samples:0 is honest.
    expect(summary.webVitals.map((v) => v.metric)).toEqual(Object.keys(WEB_VITAL_SPECS));
    const cls = summary.webVitals.find((v) => v.metric === "CLS");
    expect(cls?.samples).toBe(0);
    expect(cls?.reportable).toBe(false);
  });

  it("hides per-path rows under the sample floor and sorts worst first", async () => {
    const summary = await summarize();
    const paths = summary.lcpByPath.map((r) => r.path);

    // "/eat" has 3 samples of 9000ms — the most alarming number in the set,
    // and precisely the one that must NOT be shown: 3 loads is not evidence.
    expect(paths).not.toContain("/eat");
    expect(paths).toEqual(["/ferry", "/"]);
    expect(summary.lcpByPath[0].p75).toBeGreaterThan(summary.lcpByPath[1].p75);
    expect(summary.lcpByPath.every((r) => r.samples >= WEB_VITAL_MIN_SAMPLES)).toBe(true);
  });

  it("leaves the other analytics rollups untouched", async () => {
    // Web vitals share the event log with pageviews; a webvital must not be
    // miscounted as one, or the Chamber's LTAC visit numbers inflate.
    const summary = await summarize();
    expect(summary.pageviews).toBe(0);
    expect(summary.outboundClicks).toBe(0);
    expect(summary.geoPings).toBe(0);
  });
});

describe("WEB_VITAL_SPECS", () => {
  it("keeps LCP's good threshold identical to NFR-1 / M-18-02", () => {
    // If the requirement ever moves, this is the line that should force the
    // conversation — not a silently divergent dashboard.
    expect(WEB_VITAL_SPECS.LCP.good).toBe(2500);
  });

  it("orders every metric's thresholds good < poor", () => {
    for (const [metric, spec] of Object.entries(WEB_VITAL_SPECS)) {
      expect(spec.good, `${metric} good must be below poor`).toBeLessThan(spec.poor);
    }
  });
});
