// The kiosk must never inflate visitor numbers (E22).
//
// These are the figures the Chamber reports to LTAC. One shared wall panel that
// never leaves Kingston is not a visitor: counting it would add sessions that
// are really one device, pin a geography bucket to the Chamber's own
// connection, and drag the web-vitals p75 with a machine that reloads itself
// every fifteen minutes. Getting this wrong is not a rendering bug — it is
// putting a wrong number in a public funding report, which is why it is pinned
// here rather than trusted to a code comment.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { saveEvent, summarize, type AnalyticsEvent } from "@/lib/analytics-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => null),
  can: vi.fn(() => false),
}));

const WEB_SESSION = "vk-web-1";
const KIOSK_SESSION_A = "vk-kiosk-aaa";
const KIOSK_SESSION_B = "vk-kiosk-bbb";

function event(over: Partial<AnalyticsEvent>): AnalyticsEvent {
  return {
    ts: new Date("2026-07-21T18:00:00Z").toISOString(),
    type: "pageview",
    path: "/eat",
    sessionId: WEB_SESSION,
    geo: { source: "unknown" },
    ...over,
  };
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();

  // Two genuine web visitors.
  await saveEvent(event({ sessionId: "vk-web-1", path: "/eat" }));
  await saveEvent(event({ sessionId: "vk-web-2", path: "/ferry" }));
  await saveEvent(event({ sessionId: "vk-web-2", type: "outbound", href: "https://x.test", label: "Menu" }));

  // The kiosk: two walk-ups, four screen views. If these leaked into the
  // rollups they would look like two more visitors and four more pageviews.
  await saveEvent(event({ sessionId: KIOSK_SESSION_A, path: "/kiosk", source: "kiosk" }));
  await saveEvent(event({ sessionId: KIOSK_SESSION_A, path: "/kiosk/eat", source: "kiosk" }));
  await saveEvent(event({ sessionId: KIOSK_SESSION_B, path: "/kiosk", source: "kiosk" }));
  await saveEvent(event({ sessionId: KIOSK_SESSION_B, path: "/kiosk/ferry", source: "kiosk" }));
});
afterAll(async () => {
  await tdb.close();
});

describe("summarize() keeps the kiosk out of every visitor figure", () => {
  it("counts only web pageviews and web sessions", async () => {
    const s = await summarize();
    expect(s.pageviews, "kiosk screen views leaked into visitor pageviews").toBe(2);
    expect(s.uniqueSessions, "kiosk walk-ups leaked into visitor sessions").toBe(2);
  });

  it("never lists a kiosk path in the visitor page table", async () => {
    const s = await summarize();
    const kioskPaths = s.pageviewsByPath.filter((r) => r.path.startsWith("/kiosk"));
    expect(kioskPaths, `kiosk paths in the visitor table: ${JSON.stringify(kioskPaths)}`).toEqual([]);
  });

  it("never counts a kiosk session in a geography bucket", async () => {
    // The kiosk sits on one connection in one town. Its rows would bind a
    // permanent, growing session count to a single geo bucket and make the
    // "where are visitors coming from" table quietly wrong.
    const s = await summarize();
    const totalGeoSessions = s.sessionsByGeo.reduce((n, r) => n + r.sessions, 0);
    expect(totalGeoSessions).toBe(2);
  });

  it("never counts a kiosk session in the per-day table", async () => {
    const s = await summarize();
    for (const day of s.byDay) {
      expect(day.sessions, `day ${day.day} counted a kiosk session`).toBeLessThanOrEqual(2);
      expect(day.pageviews, `day ${day.day} counted a kiosk pageview`).toBeLessThanOrEqual(2);
    }
  });
});

describe("summarize() reports the kiosk as its own series", () => {
  it("counts kiosk screen views and walk-ups", async () => {
    const s = await summarize();
    expect(s.kiosk.pageviews).toBe(4);
    // Two ids, because KioskShell rotates on idle reset — one id is roughly one
    // person's visit to the panel, which is the number worth reporting.
    expect(s.kiosk.sessions).toBe(2);
  });

  it("reports which screens people actually open, most-used first", async () => {
    const s = await summarize();
    expect(s.kiosk.byPath[0]).toEqual({ path: "/kiosk", count: 2 });
    const paths = s.kiosk.byPath.map((r) => r.path);
    expect(paths).toContain("/kiosk/eat");
    expect(paths).toContain("/kiosk/ferry");
    // Every row in this series is a kiosk row — nothing from the website.
    expect(paths.every((p) => p.startsWith("/kiosk"))).toBe(true);
  });

  it("treats an event with no source as a visitor, forever", async () => {
    // Every event written before the kiosk existed has no `source`. If absence
    // ever stopped meaning "website", the whole historical series would move.
    const s = await summarize();
    expect(s.pageviews + s.kiosk.pageviews).toBe(6);
  });
});
