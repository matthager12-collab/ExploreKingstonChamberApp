// THE MODERATION FLOOR, ON THE KIOSK RENDER PATH (E22 / FR-A01) — CI-blocking.
//
// The launch floor is that nothing a non-admin submits appears publicly without
// Chamber approval. tests/unit/moderation-gate.test.ts proves that for pages,
// feeds and embeds. The kiosk is a FOURTH public render path, and it is the one
// nobody will notice is wrong: it hangs on a wall in public, has no address bar,
// and no visitor is going to report that a listing looks unapproved.
//
// The kiosk earns this for free — its screens call the same public getters the
// website does, and readMerged() filters to live. That is precisely the claim
// worth pinning: a future edit that "optimises" a kiosk screen onto a
// readMergedAdmin variant, or hand-rolls a query, would publish pending content
// to a public panel with nothing else failing.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { writeRecord } from "@/lib/db/records";
import { getEvents } from "@/lib/stores/event-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { getRestaurants } from "@/lib/stores/business-store";
import { getParkingZones } from "@/lib/stores/parking-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

// No session: the kiosk is signed out, always. If any getter below quietly
// depended on an admin session to filter, this is what would expose it.
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => null),
  can: vi.fn(() => false),
}));

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();

  // One pending and one live record in each store a kiosk screen renders.
  await writeRecord("restaurants", {
    id: "kiosk-live-cafe",
    name: "Live Cafe",
    cuisine: "Cafe",
    description: "Approved and published.",
    address: "1 Main St",
    priceLevel: 1,
    tags: [],
    lat: 47.797,
    lng: -122.497,
    walkMinutesFromFerry: 2,
  }, { status: "live" });
  await writeRecord("restaurants", {
    id: "kiosk-pending-cafe",
    name: "Pending Cafe",
    cuisine: "Cafe",
    description: "Submitted, NOT yet approved.",
    address: "2 Main St",
    priceLevel: 1,
    tags: [],
    lat: 47.798,
    lng: -122.498,
    walkMinutesFromFerry: 3,
  }, { status: "pending" });

  await writeRecord("events", {
    id: "kiosk-live-event",
    title: "Live Event",
    start: "2099-01-01T18:00:00-08:00",
    venue: "Village Green",
    description: "Approved.",
    category: "community",
    organizer: "Chamber",
  }, { status: "live" });
  await writeRecord("events", {
    id: "kiosk-pending-event",
    title: "Pending Event",
    start: "2099-01-02T18:00:00-08:00",
    venue: "Village Green",
    description: "NOT approved.",
    category: "community",
    organizer: "Anonymous",
  }, { status: "pending" });

  await writeRecord("lodging", {
    id: "kiosk-live-inn",
    name: "Live Inn",
    type: "hotel",
    description: "Approved.",
    tags: [],
  }, { status: "live" });
  await writeRecord("lodging", {
    id: "kiosk-pending-inn",
    name: "Pending Inn",
    type: "hotel",
    description: "NOT approved.",
    tags: [],
  }, { status: "pending" });

  await writeRecord("parking-zones", {
    id: "kiosk-live-lot",
    name: "Live Lot",
    rule: "free",
    summary: "Approved.",
    details: "Approved.",
    confidence: "verified",
    overnight: "no",
    center: [47.797, -122.497],
  }, { status: "live" });
  await writeRecord("parking-zones", {
    id: "kiosk-pending-lot",
    name: "Pending Lot",
    rule: "free",
    summary: "NOT approved.",
    details: "NOT approved.",
    confidence: "unverified",
    overnight: "no",
    center: [47.798, -122.498],
  }, { status: "pending" });
});
afterAll(async () => {
  await tdb.close();
});

describe("kiosk render path renders live records only", () => {
  it.each([
    ["/kiosk/eat", getRestaurants, "kiosk-live-cafe", "kiosk-pending-cafe"],
    ["/kiosk/events", getEvents, "kiosk-live-event", "kiosk-pending-event"],
    ["/kiosk/stay", getLodging, "kiosk-live-inn", "kiosk-pending-inn"],
    ["/kiosk/parking", getParkingZones, "kiosk-live-lot", "kiosk-pending-lot"],
  ] as const)("%s shows the approved record and hides the pending one", async (
    _screen,
    getter,
    liveId,
    pendingId,
  ) => {
    const rows = (await getter()) as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids, "the approved record must be visible").toContain(liveId);
    expect(ids, "a PENDING record reached a public kiosk screen").not.toContain(pendingId);
  });

  it("never leaks the unapproved wording into what a screen would render", () => {
    // Belt-and-braces on the same property, phrased the way a reviewer would
    // check it by eye: no field of any returned record mentions the pending
    // fixture at all.
    return Promise.all(
      [getRestaurants, getEvents, getLodging, getParkingZones].map(async (getter) => {
        const serialised = JSON.stringify(await getter());
        expect(serialised).not.toContain("NOT yet approved");
        expect(serialised).not.toContain("NOT approved");
      }),
    );
  });
});
