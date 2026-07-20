// THE MODERATION GATE (E08) — CI-blocking enforcement of the launch floor
// (M-16-01 / FR-A01 / FR-A98): nothing a non-admin submits appears publicly
// without Chamber approval, and a member write NEVER mutates live content.
//
// Layers under test, member-role mocked end to end:
//  (a) store gating — pending/draft records are invisible through every
//      default getter and visible (status surfaced) through the *Admin one;
//  (b) member write paths (listing PUT, events POST/DELETE, org PUT/POST,
//      needs POST incl. the slots stepper) — no live-content change, exactly
//      one open moderation item;
//  (c) approve / reject / takedown — approve publishes + resolves + audits,
//      reject changes nothing, takedown unpublishes now;
//  (d) the public feeds and ?onDate= branches exclude pending records.
// The report-intake privacy invariant lives in src/lib/schemas/worklist.test.ts
// and the sweep idempotency suite arrives with the sweep route.

import { NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/db/schema";
import { readRecords, writeRecord } from "@/lib/db/records";
import { charities as charitySeed } from "@/lib/data/charities";
import { itineraries as itinerarySeed } from "@/lib/data/itineraries";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { webcams as webcamSeed } from "@/lib/data/webcams";
import {
  approveModerationItem,
  rejectModerationItem,
  takedownLiveRecord,
} from "@/lib/moderation";
import { getCharities, getCharitiesAdmin, getVolunteerNeeds, getVolunteerNeedsAdmin } from "@/lib/stores/charity-store";
import { getEvents, getEventsAdmin } from "@/lib/stores/event-store";
import { getItineraries, getItinerariesAdmin } from "@/lib/stores/itinerary-store";
import { getLodging, getLodgingAdmin, getWebcams, getWebcamsAdmin } from "@/lib/stores/listing-stores";
import { getRestaurant, getRestaurants, getRestaurantsAdmin } from "@/lib/stores/business-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

// Switchable session: admin publishes directly, members hold for review.
const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    role: string;
    orgId: string | null;
    editableIds: string[];
    entitlements: Record<string, unknown>;
    name: string;
    email: string;
  },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  // Mirrors the real rule closely enough for these routes: admin passes,
  // org roles pass when the resource id is linked.
  can: vi.fn(
    (u: { role: string; editableIds: string[] }, _a: string, r?: string) =>
      u.role === "admin" || (r != null && u.editableIds.includes(r)),
  ),
}));

import { PUT as listingPUT } from "@/app/api/portal/listing/route";
import {
  DELETE as eventsDELETE,
  GET as eventsGET,
  POST as eventsPOST,
} from "@/app/api/portal/events/route";
import { POST as orgPOST, PUT as orgPUT } from "@/app/api/portal/org/route";
import { POST as needsPOST } from "@/app/api/portal/needs/route";
import { GET as feedsEventsGET } from "@/app/api/feeds/events/route";
import { GET as feedsBusinessGET } from "@/app/api/feeds/business/[id]/route";

const seedRestaurant = restaurantSeed[0];
const seedCharity = charitySeed[0];

function asMember(...editableIds: string[]) {
  authState.user = {
    id: "member-1",
    role: "member-business",
    orgId: "org-x",
    editableIds,
    entitlements: {},
    name: "Member",
    email: "member@example.test",
  };
}
function asAdmin() {
  authState.user = {
    id: "admin-1",
    role: "admin",
    orgId: null,
    editableIds: [],
    entitlements: {},
    name: "Admin",
    email: "admin@example.test",
  };
}
const ADMIN = { id: "admin-1", email: "admin@example.test" };

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function openModeration(subjectStore?: string) {
  const items = await listWorklistItems({ type: "moderation", state: "open" });
  return subjectStore ? items.filter((i) => i.subjectStore === subjectStore) : items;
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

/* ------------------------- (a) store-layer gating ------------------------- */

describe("(a) default getters are live-only; *Admin variants surface everything", () => {
  // One pending + one draft doc per store, shaped to satisfy the store
  // write-gate whether it is running baseline or strict schemas: derived
  // from a real seed record where one exists.
  const CASES: {
    store: string;
    docs: [Record<string, unknown>, Record<string, unknown>];
    getPublic: () => Promise<{ id: string }[]>;
    getAdmin: () => Promise<({ id: string } & { status: string })[]>;
  }[] = [
    {
      store: "restaurants",
      docs: [
        { ...seedRestaurant, id: "gate-pending-restaurant", name: "Pending Cafe" },
        { ...seedRestaurant, id: "gate-draft-restaurant", name: "Draft Cafe" },
      ],
      getPublic: getRestaurants,
      getAdmin: getRestaurantsAdmin,
    },
    {
      store: "events",
      docs: [
        { id: "gate-pending-event", title: "Pending Fest", start: "2027-06-01T10:00:00-07:00" },
        { id: "gate-draft-event", title: "Draft Fest", start: "2027-06-02T10:00:00-07:00" },
      ],
      getPublic: getEvents,
      getAdmin: getEventsAdmin,
    },
    {
      store: "charities",
      docs: [
        { id: "gate-pending-charity", name: "Pending Org" },
        { id: "gate-draft-charity", name: "Draft Org" },
      ],
      getPublic: getCharities,
      getAdmin: getCharitiesAdmin,
    },
    {
      store: "volunteer-needs",
      docs: [
        {
          id: "gate-pending-need",
          title: "Pending Shift",
          date: "2027-06-01T00:00:00-07:00",
          charityId: "org-x",
          timeRange: "9–1",
          slotsTotal: 4,
          slotsFilled: 0,
        },
        {
          id: "gate-draft-need",
          title: "Draft Shift",
          date: "2027-06-02T00:00:00-07:00",
          charityId: "org-x",
          timeRange: "9–1",
          slotsTotal: 4,
          slotsFilled: 0,
        },
      ],
      getPublic: getVolunteerNeeds,
      getAdmin: getVolunteerNeedsAdmin,
    },
    {
      // Seed-derived docs: these three domains validate under the STRICT
      // DOMAIN_SCHEMAS since the #30 swap, so minimal stubs won't pass the
      // write-gate (which is the whole point of the gate).
      store: "lodging",
      docs: [
        { ...lodgingSeed[0], id: "gate-pending-lodging", name: "Pending Inn" },
        { ...lodgingSeed[0], id: "gate-draft-lodging", name: "Draft Inn" },
      ],
      getPublic: getLodging,
      getAdmin: getLodgingAdmin,
    },
    {
      store: "webcams",
      docs: [
        { ...webcamSeed[0], id: "gate-pending-webcam", name: "Pending Cam" },
        { ...webcamSeed[0], id: "gate-draft-webcam", name: "Draft Cam" },
      ],
      getPublic: getWebcams,
      getAdmin: getWebcamsAdmin,
    },
    {
      store: "itineraries",
      docs: [
        {
          ...itinerarySeed[0],
          id: "gate-pending-itin",
          slug: "gate-pending-itin",
          title: "Pending Day",
        },
        {
          ...itinerarySeed[0],
          id: "gate-draft-itin",
          slug: "gate-draft-itin",
          title: "Draft Day",
        },
      ],
      getPublic: getItineraries,
      getAdmin: getItinerariesAdmin,
    },
  ];

  it.each(CASES.map((c) => [c.store, c] as const))(
    "%s: pending+draft invisible publicly, visible with status via admin",
    async (_store, c) => {
      const [pendingDoc, draftDoc] = c.docs;
      await writeRecord(c.store, pendingDoc as { id: string }, { status: "pending" });
      await writeRecord(c.store, draftDoc as { id: string }, { status: "draft" });

      const publicIds = (await c.getPublic()).map((r) => r.id);
      expect(publicIds).not.toContain(pendingDoc.id);
      expect(publicIds).not.toContain(draftDoc.id);

      const admin = await c.getAdmin();
      expect(admin.find((r) => r.id === pendingDoc.id)?.status).toBe("pending");
      expect(admin.find((r) => r.id === draftDoc.id)?.status).toBe("draft");
      // Seed-only records read as live through the admin variant.
      const anySeed = admin.find(
        (r) => r.id !== pendingDoc.id && r.id !== draftDoc.id,
      );
      if (anySeed) expect(anySeed.status).toBe("live");
    },
  );
});

/* -------------------- (b) member writes hold for review ------------------- */

describe("(b) member writes: no live-content change + exactly one open moderation item", () => {
  it("listing PUT: live restaurant untouched; open 'edit' item carries the proposal", async () => {
    asMember(seedRestaurant.id);
    const res = await listingPUT(
      jsonReq("/api/portal/listing", "PUT", {
        id: seedRestaurant.id,
        description: "A better description, pending review",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pending).toBe(true);

    const publicRecord = await getRestaurant(seedRestaurant.id);
    expect(publicRecord?.description).toBe(seedRestaurant.description);

    const items = await openModeration("restaurants");
    expect(items).toHaveLength(1);
    expect(items[0].payload).toMatchObject({ kind: "edit" });
    expect(
      (items[0].payload.proposed as { description: string }).description,
    ).toBe("A better description, pending review");
  });

  it("events POST (create): stored as pending, invisible everywhere public, one open 'new' item", async () => {
    asMember("owner-biz");
    const res = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ownerId: "owner-biz",
        title: "Members Night",
        start: "2027-07-01T18:00",
        category: "community",
      }),
    );
    expect(res.status).toBe(200);
    const { event, pending } = await res.json();
    expect(pending).toBe(true);

    expect((await getEvents()).map((e) => e.id)).not.toContain(event.id);
    const stored = await readRecords<{ id: string }>("events", { statuses: ["pending"] });
    expect(stored.map((r) => r.id)).toContain(event.id);

    const items = await openModeration("events");
    expect(items.filter((i) => i.subjectId === event.id)).toHaveLength(1);
    expect(items.find((i) => i.subjectId === event.id)?.payload).toMatchObject({ kind: "new" });

    // Public deconfliction lookup must not leak it either.
    const onDate = await eventsGET(
      new NextRequest("http://localhost/api/portal/events?onDate=2027-07-01"),
    );
    const onDateJson = await onDate.json();
    expect((onDateJson.events as { id: string }[]).map((e) => e.id)).not.toContain(event.id);

    // Nor the public feed (JSON and ICS) — the embed rides the JSON feed.
    const feed = await feedsEventsGET(new NextRequest("http://localhost/api/feeds/events"));
    const feedJson = await feed.json();
    expect((feedJson.events as { id: string }[]).map((e) => e.id)).not.toContain(event.id);
    const ics = await feedsEventsGET(
      new NextRequest("http://localhost/api/feeds/events?format=ics"),
    );
    expect(await ics.text()).not.toContain(event.id);
  });

  it("events POST (edit of a live event): live version keeps serving; proposal rides the item", async () => {
    asAdmin();
    const created = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ownerId: "owner-biz",
        title: "Live Concert",
        start: "2027-07-02T19:00",
        category: "music",
      }),
    );
    const liveEvent = (await created.json()).event as { id: string; title: string };
    expect((await getEvents()).map((e) => e.id)).toContain(liveEvent.id);

    asMember("owner-biz");
    const res = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        id: liveEvent.id,
        ownerId: "owner-biz",
        title: "Live Concert (new name)",
        start: "2027-07-02T20:00",
        category: "music",
      }),
    );
    expect((await res.json()).pending).toBe(true);

    const publicNow = (await getEvents()).find((e) => e.id === liveEvent.id);
    expect(publicNow?.title).toBe("Live Concert");

    const item = (await openModeration("events")).find((i) => i.subjectId === liveEvent.id);
    expect(item?.payload).toMatchObject({ kind: "edit" });
    expect((item?.payload.proposed as { title: string }).title).toBe("Live Concert (new name)");
  });

  it("org PUT: live charity untouched; open 'edit' item holds the proposal", async () => {
    asMember(seedCharity.id);
    const res = await orgPUT(
      jsonReq("/api/portal/org", "PUT", { id: seedCharity.id, mission: "A bolder mission" }),
    );
    expect((await res.json()).pending).toBe(true);
    expect((await getCharities()).find((c) => c.id === seedCharity.id)?.mission).toBe(
      seedCharity.mission,
    );
    const item = (await openModeration("charities")).find((i) => i.subjectId === seedCharity.id);
    expect((item?.payload.proposed as { mission: string }).mission).toBe("A bolder mission");
  });

  it("org POST saveEvent: nonprofit event lands pending with one open item", async () => {
    asMember("org-np");
    // The org must exist (live) for the route's lookup.
    asAdmin();
    await writeRecord("charities", { id: "org-np", name: "Nonprofit X" }, { status: "live" });
    asMember("org-np");
    const res = await orgPOST(
      jsonReq("/api/portal/org", "POST", {
        action: "saveEvent",
        orgId: "org-np",
        event: {
          title: "Charity Gala",
          date: "2027-07-03",
          startTime: "18:00",
          venue: "Community Hall",
        },
      }),
    );
    expect(res.status).toBe(200);
    const { event, pending } = await res.json();
    expect(pending).toBe(true);
    expect((await getEvents()).map((e) => e.id)).not.toContain(event.id);
    expect((await openModeration("events")).filter((i) => i.subjectId === event.id)).toHaveLength(
      1,
    );
  });

  it("needs POST create + slots stepper: live shift untouched; stepper proposal holds", async () => {
    asAdmin();
    await writeRecord(
      "volunteer-needs",
      {
        id: "live-shift",
        title: "Live Shift",
        date: "2027-07-04T00:00:00-07:00",
        charityId: "org-np",
        timeRange: "9–1",
        slotsTotal: 4,
        slotsFilled: 1,
      },
      { status: "live" },
    );

    asMember("org-np");
    const created = await needsPOST(
      jsonReq("/api/portal/needs", "POST", {
        charityId: "org-np",
        title: "New Shift",
        date: "2027-07-05",
        timeRange: "10–2",
      }),
    );
    const createdJson = await created.json();
    expect(createdJson.pending).toBe(true);
    expect((await getVolunteerNeeds()).map((n) => n.id)).not.toContain(createdJson.need.id);

    const stepped = await needsPOST(
      jsonReq("/api/portal/needs", "POST", { action: "slots", id: "live-shift", delta: 1 }),
    );
    const steppedJson = await stepped.json();
    expect(steppedJson.pending).toBe(true);
    expect(
      (await getVolunteerNeeds()).find((n) => n.id === "live-shift")?.slotsFilled,
    ).toBe(1);
    const item = (await openModeration("volunteer-needs")).find(
      (i) => i.subjectId === "live-shift",
    );
    expect((item?.payload.proposed as { slotsFilled: number }).slotsFilled).toBe(2);
  });

  it("events DELETE: member removal of a live event holds; their own pending event withdraws", async () => {
    asAdmin();
    const created = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ownerId: "owner-biz",
        title: "Doomed Event",
        start: "2027-07-06T12:00",
        category: "community",
      }),
    );
    const liveEvent = (await created.json()).event as { id: string };

    asMember("owner-biz");
    const del = await eventsDELETE(
      new NextRequest(`http://localhost/api/portal/events?id=${liveEvent.id}`, {
        method: "DELETE",
      }),
    );
    expect((await del.json()).pending).toBe(true);
    expect((await getEvents()).map((e) => e.id)).toContain(liveEvent.id);
    const item = (await openModeration("events")).find((i) => i.subjectId === liveEvent.id);
    expect(item?.payload).toMatchObject({ kind: "takedown" });

    // Their own pending record: withdrawal is immediate and dismisses the item.
    const pendingRes = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ownerId: "owner-biz",
        title: "Withdrawn Event",
        start: "2027-07-07T12:00",
        category: "community",
      }),
    );
    const pendingEvent = (await pendingRes.json()).event as { id: string };
    const withdraw = await eventsDELETE(
      new NextRequest(`http://localhost/api/portal/events?id=${pendingEvent.id}`, {
        method: "DELETE",
      }),
    );
    expect((await withdraw.json()).ok).toBe(true);
    const pendingRows = await readRecords<{ id: string; _deleted?: boolean }>("events");
    expect(pendingRows.find((r) => r.id === pendingEvent.id)?._deleted).toBe(true);
    expect(
      (await openModeration("events")).filter((i) => i.subjectId === pendingEvent.id),
    ).toHaveLength(0);
  });
});

/* ---------------------- (c) approve / reject / takedown ------------------- */

describe("(c) admin resolutions", () => {
  it("approve of an edit publishes the proposal, resolves the item, writes ≥2 audit rows", async () => {
    const item = (await openModeration("restaurants")).find(
      (i) => i.subjectId === seedRestaurant.id,
    );
    expect(item).toBeDefined();

    const [{ n: before }] = await tdb.db.select({ n: count() }).from(audit);
    await approveModerationItem(item!, ADMIN);
    const [{ n: after }] = await tdb.db.select({ n: count() }).from(audit);
    expect(Number(after) - Number(before)).toBeGreaterThanOrEqual(2);

    expect((await getRestaurant(seedRestaurant.id))?.description).toBe(
      "A better description, pending review",
    );
    const resolved = await listWorklistItems({ type: "moderation", state: "resolved" });
    expect(
      resolved.find((i) => i.subjectId === seedRestaurant.id)?.resolution,
    ).toBe("approved");
  });

  it("approve of a 'new' flips the pending record live and the feed serves it", async () => {
    const item = (await openModeration("events")).find(
      (i) => i.subjectLabel === "Members Night",
    );
    expect(item).toBeDefined();
    await approveModerationItem(item!, ADMIN);

    expect((await getEvents()).map((e) => e.id)).toContain(item!.subjectId);
    const feed = await feedsEventsGET(new NextRequest("http://localhost/api/feeds/events"));
    const feedJson = await feed.json();
    expect((feedJson.events as { id: string }[]).map((e) => e.id)).toContain(item!.subjectId);
  });

  it("reject leaves a pending record pending and records the note", async () => {
    const item = (await openModeration("events")).find(
      (i) => i.subjectLabel === "Charity Gala",
    );
    expect(item).toBeDefined();
    await rejectModerationItem(item!, "Needs a venue address", ADMIN);

    expect((await getEvents()).map((e) => e.id)).not.toContain(item!.subjectId);
    const stored = await readRecords<{ id: string }>("events", { statuses: ["pending"] });
    expect(stored.map((r) => r.id)).toContain(item!.subjectId);
    const resolved = await listWorklistItems({ type: "moderation", state: "resolved" });
    const done = resolved.find((i) => i.id === item!.id);
    expect(done?.resolution).toBe("rejected");
    expect(done?.resolutionNote).toBe("Needs a venue address");
  });

  it("one-click takedown pulls a live record off every public surface now", async () => {
    asAdmin();
    const created = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ownerId: "owner-biz",
        title: "Problem Event",
        start: "2027-07-08T12:00",
        category: "community",
      }),
    );
    const liveEvent = (await created.json()).event as { id: string };
    expect((await getEvents()).map((e) => e.id)).toContain(liveEvent.id);

    await takedownLiveRecord("events", liveEvent.id, ADMIN, "Reported as fraudulent");

    expect((await getEvents()).map((e) => e.id)).not.toContain(liveEvent.id);
    const feed = await feedsEventsGET(new NextRequest("http://localhost/api/feeds/events"));
    expect(
      ((await feed.json()).events as { id: string }[]).map((e) => e.id),
    ).not.toContain(liveEvent.id);
    expect(
      (await getEventsAdmin()).find((e) => e.id === liveEvent.id)?.status,
    ).toBe("pending");

    const resolved = await listWorklistItems({ type: "moderation", state: "resolved" });
    const item = resolved.find(
      (i) => i.subjectId === liveEvent.id && i.resolution === "taken_down",
    );
    expect(item?.payload).toMatchObject({ kind: "takedown" });
  });

  it("business feed 404s a pending restaurant (indistinguishable from unknown)", async () => {
    const res = await feedsBusinessGET(
      new NextRequest("http://localhost/api/feeds/business/gate-pending-restaurant"),
      { params: Promise.resolve({ id: "gate-pending-restaurant" }) },
    );
    expect(res.status).toBe(404);
  });
});
