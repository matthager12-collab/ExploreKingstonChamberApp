// Scarecrow Crawl registration — a business puts its scarecrow forward, and
// nothing goes public until the Chamber approves it.
//
// The clock is faked to late September, inside the registration window; the
// window test moves it deliberately.

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";
import { CRAWL_VIEW_ID } from "@/lib/data/scarecrows";
import { approveModerationItem } from "@/lib/moderation";
import { getMapFeatures, getMapFeaturesAdmin, saveMapFeature } from "@/lib/stores/map-store";
import { getCrawlScarecrows } from "@/lib/stores/scarecrow-store";
import { setPageHidden } from "@/lib/stores/site-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import { POST } from "@/app/api/scarecrow/register/route";

const IN_WINDOW = new Date("2026-09-28T12:00:00-07:00");
const ADMIN = { id: "admin-under-test", email: "admin@example.test" };

const valid = {
  title: "Farmer Fergus",
  creator: "Kingston Cooperative Preschool",
  notes: "11225 NE State Hwy 104 — in the front window",
  submitterName: "Pat Registrant",
  contact: "pat.registrant@example.test",
};

function registerRaw(raw: string, ip: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/scarecrow/register", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(raw)),
        "x-forwarded-for": ip,
        ...headers,
      },
    }),
  );
}

const register = (body: Record<string, unknown>, ip: string) => registerRaw(JSON.stringify(body), ip);

async function heldRegistrations() {
  return (
    await listWorklistItems({ type: "moderation", state: ["open"], subjectStore: "map-features" })
  ).filter((i) => (i.payload as { kind?: string }).kind === "new");
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(IN_WINDOW);
});
afterAll(async () => {
  vi.useRealTimers();
  await tdb.close();
});
afterEach(() => {
  vi.setSystemTime(IN_WINDOW);
});

describe("POST /api/scarecrow/register", () => {
  it("holds a registration: pending, not public, in the Worklist with the contact", async () => {
    const before = (await heldRegistrations()).length;
    const res = await register(valid, "198.51.100.10");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const held = await heldRegistrations();
    expect(held.length).toBe(before + 1);
    const item = held.find((i) => i.subjectLabel.includes("Farmer Fergus"))!;
    expect((item.payload as { suggest?: { contact?: string } }).suggest?.contact).toBe(valid.contact);

    // Held as a pending marker on the crawl view...
    const pending = (await getMapFeaturesAdmin()).find((f) => f.id === item.subjectId)!;
    expect(pending.status).toBe("pending");
    expect(pending.views).toEqual([CRAWL_VIEW_ID]);
    expect(pending.creator).toBe(valid.creator);

    // ...that no public read can see: not the map, not the list, not the ballot.
    expect((await getMapFeatures()).some((f) => f.id === item.subjectId)).toBe(false);
    expect((await getCrawlScarecrows()).some((s) => s.id === item.subjectId)).toBe(false);
  });

  it("goes live on the trail when an admin approves it — unplaced if it came without coordinates", async () => {
    await register({ ...valid, title: "Approve Me" }, "198.51.100.11");
    const item = (await heldRegistrations()).find((i) => i.subjectLabel.includes("Approve Me"))!;

    await approveModerationItem(item, ADMIN);

    const live = (await getCrawlScarecrows()).find((s) => s.id === item.subjectId);
    expect(live?.title).toBe("Approve Me");
    expect(live?.placed).toBe(false);
  });

  it("keeps coordinates that are inside Kingston, and the entry is placed once approved", async () => {
    await register({ ...valid, title: "Placed Pin", lat: 47.7981, lng: -122.496 }, "198.51.100.12");
    const item = (await heldRegistrations()).find((i) => i.subjectLabel.includes("Placed Pin"))!;
    await approveModerationItem(item, ADMIN);
    const live = (await getCrawlScarecrows()).find((s) => s.id === item.subjectId)!;
    expect([live.lat, live.lng]).toEqual([47.7981, -122.496]);
    expect(live.placed).toBe(true);
  });

  it("makes its own id — a client-sent id cannot overwrite a live pin", async () => {
    await saveMapFeature({
      id: "a-live-pin",
      kind: "marker",
      title: "Someone else's live pin",
      views: ["explore"],
      point: [47.799, -122.497],
    });
    const res = await register({ ...valid, title: "Hijacker", id: "a-live-pin", views: ["explore"] }, "198.51.100.13");
    expect(res.status).toBe(200);

    const untouched = (await getMapFeatures()).find((f) => f.id === "a-live-pin")!;
    expect(untouched.title).toBe("Someone else's live pin");

    const item = (await heldRegistrations()).find((i) => i.subjectLabel.includes("Hijacker"))!;
    expect(item.subjectId).not.toBe("a-live-pin");
    expect(item.subjectId).toMatch(/^scarecrow-hijacker-[0-9a-f]{8}$/);
    const held = (await getMapFeaturesAdmin()).find((f) => f.id === item.subjectId)!;
    expect(held.views).toEqual([CRAWL_VIEW_ID]);
  });

  it("refuses registrations once the crawl has opened (403), and holds nothing", async () => {
    vi.setSystemTime(new Date("2026-10-17T00:00:01-07:00"));
    const before = (await heldRegistrations()).length;
    const res = await register({ ...valid, title: "Too Late" }, "198.51.100.14");
    expect(res.status).toBe(403);
    expect((await heldRegistrations()).length).toBe(before);
  });

  it("answers a filled honeypot with a bland 200 and stores nothing", async () => {
    const before = (await heldRegistrations()).length;
    const res = await register({ ...valid, title: "Bot Entry", website2: "http://spam.example" }, "198.51.100.15");
    expect(res.status).toBe(200);
    expect((await heldRegistrations()).length).toBe(before);
  });

  it("requires every field and caps its length (400)", async () => {
    expect((await register({ ...valid, contact: "" }, "198.51.100.16")).status).toBe(400);
    expect((await register({ ...valid, title: "x".repeat(81) }, "198.51.100.17")).status).toBe(400);
    expect((await register({ ...valid, notes: "   " }, "198.51.100.18")).status).toBe(400);
  });

  it("refuses coordinates outside Kingston, or half a pair (400)", async () => {
    expect((await register({ ...valid, lat: 40.7, lng: -74.0 }, "198.51.100.19")).status).toBe(400);
    expect((await register({ ...valid, lat: 47.798 }, "198.51.100.20")).status).toBe(400);
    expect((await register({ ...valid, lat: "north", lng: "west" }, "198.51.100.21")).status).toBe(400);
  });

  it("bounds the body before parsing: no length (411), too large (413), not an object (400)", async () => {
    const noLength = await POST(
      new NextRequest("http://localhost/api/scarecrow/register", {
        method: "POST",
        body: JSON.stringify(valid),
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.22" },
      }),
    );
    expect(noLength.status).toBe(411);

    const huge = JSON.stringify({ ...valid, notes: "x".repeat(10_000) });
    expect((await registerRaw(huge, "198.51.100.23")).status).toBe(413);

    expect((await registerRaw("[1,2,3]", "198.51.100.24")).status).toBe(400);
  });

  it("takes no registrations while the Chamber has the page hidden (404)", async () => {
    await setPageHidden("/scarecrow", true);
    try {
      expect((await register({ ...valid, title: "Hidden" }, "198.51.100.25")).status).toBe(404);
    } finally {
      await setPageHidden("/scarecrow", false);
    }
  });

  it("rate-limits one connection: five registrations an hour, then 429", async () => {
    const ip = "198.51.100.99";
    for (let i = 0; i < 5; i++) {
      await register({ ...valid, title: `Rate ${i}` }, ip);
    }
    const sixth = await register({ ...valid, title: "Rate 6" }, ip);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
  });
});
