// Admin content-records route on the shared domain schemas (E07): the
// operator-message contract. Every 400 body must be a friendly, plain-English
// string — raw zod default phrasing ("Invalid input: …") must never surface —
// and the two store-backed rules (restaurant hours carry-over, itinerary slug
// clash) keep their exact behavior. Runs against in-memory PGlite migrated
// with the checked-in db/migrations, same as the other route suites.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";
import { POST } from "@/app/api/admin/content-records/route";
import { saveRestaurant } from "@/lib/stores/business-store";
import type { WeeklyHours } from "@/lib/types";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => null),
  getSessionUser: vi.fn(async () => ({
    id: "u1",
    role: "admin",
    orgId: null,
    editableIds: [],
    entitlements: {},
    name: "Test",
    email: "t@t.t",
  })),
}));

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/admin/content-records", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

const LODGING = {
  id: "test-inn",
  name: "Test Inn",
  type: "hotel",
  description: "",
  address: "",
  website: "",
  bookingUrl: "",
  tags: ["Waterfront"],
};

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("POST /api/admin/content-records — operator-message contract", () => {
  it("rejects an array record with the friendly message, not raw zod phrasing", async () => {
    for (const domain of ["lodging", "webcams", "itineraries", "restaurants"]) {
      const res = await post({ domain, record: [] });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("record required");
      expect(data.error).not.toContain("Invalid input");
    }
  });

  it("surfaces the schema's friendly message on a field error", async () => {
    const res = await post({ domain: "lodging", record: { ...LODGING, website: "foo" } });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("website must be an http(s) URL");
  });

  it("saves a valid record; empty optionals come back absent", async () => {
    const res = await post({ domain: "lodging", record: LODGING });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; record: Record<string, unknown> };
    expect(data.ok).toBe(true);
    expect(data.record.id).toBe("test-inn");
    expect(Object.hasOwn(data.record, "address")).toBe(false);
    expect(Object.hasOwn(data.record, "website")).toBe(false);
  });

  it("carries stored weeklyHours/hoursVerified over on a restaurant edit", async () => {
    const weeklyHours: WeeklyHours = {
      mon: [["11:00", "20:00"]],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    };
    await saveRestaurant(
      {
        id: "hours-cafe",
        name: "Hours Cafe",
        cuisine: "Coffee",
        description: "",
        address: "1 Dock St",
        priceLevel: 1,
        tags: [],
        lat: 47.79,
        lng: -122.49,
        walkMinutesFromFerry: 2,
        weeklyHours,
        hoursVerified: "2026-07-01",
      },
      { actor: "seed@test", source: "admin" },
    );
    // The edit sends neither field (the form can't) — and even a hostile
    // payload's values must be ignored in favor of the stored ones.
    const res = await post({
      domain: "restaurants",
      record: {
        id: "hours-cafe",
        name: "Hours Cafe",
        cuisine: "Coffee",
        description: "Now with a new blurb.",
        address: "1 Dock St",
        priceLevel: 1,
        tags: [],
        lat: 47.79,
        lng: -122.49,
        walkMinutesFromFerry: 2,
        weeklyHours: { mon: [["09:00", "10:00"]], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        hoursVerified: "1999-01-01",
      },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; record: Record<string, unknown> };
    expect(data.record.weeklyHours).toEqual(weeklyHours);
    expect(data.record.hoursVerified).toBe("2026-07-01");
  });

  it("rejects an itinerary slug already used by another record, with the exact message", async () => {
    const stops = [{ time: "", title: "Start", description: "" }];
    const first = await post({
      domain: "itineraries",
      record: { id: "day-one", slug: "beach-day", title: "Day One", mode: "either", stops },
    });
    expect(first.status).toBe(200);
    const clash = await post({
      domain: "itineraries",
      record: { id: "day-two", slug: "beach-day", title: "Day Two", mode: "either", stops },
    });
    expect(clash.status).toBe(400);
    const data = (await clash.json()) as { error: string };
    expect(data.error).toBe('slug "beach-day" is already used by "Day One"');
  });
});
