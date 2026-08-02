// Our own traffic must never inflate visitor numbers, and the baseline must
// bound what gets counted at all.
//
// Same stakes as the kiosk separation suite next door: these are the figures
// the Chamber reports to LTAC, and a soft launch is exactly when the ratio of
// our-clicks to real-clicks is worst. A launch week that reads "48 visits" when
// 40 of them were us testing is not a rendering bug — it is a wrong number in a
// public funding report, so it is pinned here rather than trusted to a comment.
//
// The baseline half matters for the same reason from the other direction: it is
// the mechanism that keeps months of pre-launch development out of the first
// real week, and "hides events" is only true if the SQL bound actually holds.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { summarize, type AnalyticsEvent } from "@/lib/analytics-store";
import { analyticsEvent } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => null),
  can: vi.fn(() => false),
}));

const OLD = "2026-07-01T18:00:00Z"; // before the baseline
const NEW = "2026-08-01T18:00:00Z"; // after it
const BASELINE = "2026-07-15T00:00:00Z";

let tdb: TestDb;

/**
 * Seed one event at a chosen instant.
 *
 * Inserts directly rather than through saveEvent() because the row's `ts`
 * COLUMN is what the baseline filters on, and saveEvent() lets Postgres default
 * it to now() — which would put every row in this file at the same instant and
 * make the window assertions vacuous. The column and the payload `ts` are
 * written to the same value here, matching production, where the route stamps
 * the payload microseconds before Postgres stamps the column.
 *
 * The column is also what the E11 retention purge filters on, so "before the
 * baseline" and "past retention" can never disagree about when an event
 * happened. That agreement is the reason the baseline uses the column at all.
 */
async function seed(at: string, over: Partial<AnalyticsEvent>) {
  const event: AnalyticsEvent = {
    ts: at,
    type: "pageview",
    path: "/eat",
    sessionId: "vk-web-1",
    geo: { source: "unknown" },
    ...over,
  };
  await tdb.db.insert(analyticsEvent).values({ ts: new Date(at), event });
}

beforeAll(async () => {
  tdb = await createTestDb();

  // Two genuine visitors, after the baseline.
  await seed(NEW, { sessionId: "vk-web-1", path: "/eat" });
  await seed(NEW, { sessionId: "vk-web-2", path: "/ferry" });
  await seed(NEW, {
    sessionId: "vk-web-2",
    type: "outbound",
    href: "https://x.test",
    label: "Menu",
  });

  // Us, after the baseline: four events across two sessions. Left in the
  // visitor rollups these would read as two more visitors and a 50% jump.
  await seed(NEW, { sessionId: "vk-staff-1", path: "/eat", source: "internal" });
  await seed(NEW, { sessionId: "vk-staff-1", path: "/parking", source: "internal" });
  await seed(NEW, {
    sessionId: "vk-staff-2",
    type: "outbound",
    href: "https://y.test",
    label: "Test",
    source: "internal",
  });
  // A web vital from us. Web vitals are the sneakiest leak: a developer's
  // laptop on office wifi posts a fast LCP that quietly flatters the p75 the
  // performance budget is judged against.
  await seed(NEW, {
    sessionId: "vk-staff-1",
    type: "webvital",
    metric: "LCP",
    value: 1,
    source: "internal",
  });

  // Pre-baseline traffic: months of building, all of it real rows in the log.
  await seed(OLD, { sessionId: "vk-old-1", path: "/eat" });
  await seed(OLD, { sessionId: "vk-old-2", path: "/eat" });
  await seed(OLD, { sessionId: "vk-old-3", path: "/ferry" });
});
afterAll(async () => {
  await tdb.close();
});

describe("summarize() keeps our own traffic out of every visitor figure", () => {
  it("counts only real visitor pageviews and sessions", async () => {
    const s = await summarize(BASELINE);
    expect(s.pageviews, "internal pageviews leaked into visitor pageviews").toBe(2);
    expect(s.uniqueSessions, "internal sessions leaked into visitor sessions").toBe(2);
  });

  it("never lists an internal outbound tap in the link table", async () => {
    const s = await summarize(BASELINE);
    const hrefs = s.outboundLinks.map((r) => r.href);
    expect(hrefs).toContain("https://x.test");
    expect(hrefs, "an internal outbound tap reached the link table").not.toContain("https://y.test");
    expect(s.outboundClicks).toBe(1);
  });

  it("never counts an internal session in a geography bucket", async () => {
    const s = await summarize(BASELINE);
    const totalGeoSessions = s.sessionsByGeo.reduce((n, r) => n + r.sessions, 0);
    expect(totalGeoSessions).toBe(2);
  });

  it("never counts an internal session in the per-day table", async () => {
    const s = await summarize(BASELINE);
    for (const day of s.byDay) {
      expect(day.sessions, `day ${day.day} counted an internal session`).toBeLessThanOrEqual(2);
    }
  });

  it("never lets an internal web vital into the p75", async () => {
    // The 1ms sample above is unmissable if it leaks: any LCP percentile
    // computed with it present would collapse toward 1.
    const s = await summarize(BASELINE);
    const lcp = s.webVitals.find((v) => v.metric === "LCP");
    expect(lcp?.samples, "an internal web vital was sampled").toBe(0);
  });
});

describe("summarize() reports our traffic as its own receipt", () => {
  it("counts internal events and sessions", async () => {
    const s = await summarize(BASELINE);
    expect(s.internal.events).toBe(4);
    expect(s.internal.sessions).toBe(2);
  });

  it("nets internal events out of totalEvents so the page adds up", async () => {
    const s = await summarize(BASELINE);
    // 3 visitor events in the window; the 4 internal ones are reported
    // separately and must not also be inside the grand total.
    expect(s.totalEvents).toBe(3);
  });

  it("treats an event with no source as a visitor, forever", async () => {
    // Every event written before this mechanism existed has no `source`. If
    // absence ever stopped meaning "visitor", the whole history would move.
    const s = await summarize(BASELINE);
    expect(s.pageviews).toBe(2);
    expect(s.internal.events).toBe(4);
  });
});

describe("the analytics baseline bounds what is counted", () => {
  it("excludes everything before the baseline", async () => {
    const s = await summarize(BASELINE);
    // The three pre-baseline sessions are still in the table; they are simply
    // not in this window.
    expect(s.uniqueSessions).toBe(2);
    expect(s.byDay.every((d) => d.day >= "2026-07-15")).toBe(true);
  });

  it("hides, never deletes — clearing the baseline restores the history", async () => {
    // This is the property the whole design rests on. If it ever stopped
    // holding, "reset" would silently have become "destroy".
    const s = await summarize();
    expect(s.uniqueSessions, "pre-baseline visitors did not come back").toBe(5);
    expect(s.pageviews).toBe(5);
  });

  it("reports the window it used, so a count is never shown without its dates", async () => {
    expect((await summarize(BASELINE)).since).toBe(BASELINE);
    expect((await summarize()).since).toBeNull();
  });
});
