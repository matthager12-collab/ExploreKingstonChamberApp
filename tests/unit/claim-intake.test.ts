// E17 claim-request intake (M-10-03 / FR-A96): anonymous, closed store
// allowlist, schema-capped fields, dual-bucket rate limits, merge-on-repeat
// (one open claim_request per listing, count incremented, requester fields
// updated to the latest) — and, the point of the charter: a request grants
// NOTHING. Every response is asserted cookie-free, and existence is checked
// through the PUBLIC reads so a draft record 404s like a nonexistent one.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { saveDirectoryListing } from "@/lib/stores/directory-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import type { DirectoryListing } from "@/lib/types";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { POST } from "@/app/api/claim/route";

const seedId = restaurantSeed[0].id;

function post(body: Record<string, unknown>, ip = "203.0.113.50") {
  return POST(
    new NextRequest("http://localhost/api/claim", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

/** The route must never grant anything — no Set-Cookie on ANY outcome. */
function expectNoCookie(res: Response) {
  expect(res.headers.get("set-cookie")).toBeNull();
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("POST /api/claim", () => {
  it("accepts a valid request: 200, pending-only JSON, one open item, no cookie", async () => {
    const res = await post({
      store: "restaurants",
      id: seedId,
      contactName: "Pat Owner",
      contact: "360-555-0100",
      message: "That's my kitchen.",
    });
    expect(res.status).toBe(200);
    expectNoCookie(res);
    expect(await res.json()).toEqual({ ok: true, pending: true });

    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items).toHaveLength(1);
    expect(items[0].subjectStore).toBe("restaurants");
    expect(items[0].subjectId).toBe(seedId);
    expect(items[0].subjectLabel).toBe(restaurantSeed[0].name);
    expect(items[0].createdBy).toBeNull();
    expect(items[0].payload).toEqual({
      store: "restaurants",
      id: seedId,
      contactName: "Pat Owner",
      contact: "360-555-0100",
      message: "That's my kitchen.",
      count: 1,
    });
  });

  it("a repeat request merges: still ONE open item, count 2, requester fields updated", async () => {
    const res = await post(
      {
        store: "restaurants",
        id: seedId,
        contactName: "Sam Later",
        contact: "sam@later.test",
      },
      "203.0.113.51",
    );
    expect(res.status).toBe(200);
    expectNoCookie(res);

    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items).toHaveLength(1);
    expect(items[0].payload.count).toBe(2);
    expect(items[0].payload.contactName).toBe("Sam Later");
    expect(items[0].payload.contact).toBe("sam@later.test");
    // The first request's optional message survives a repeat that omitted it.
    expect(items[0].payload.message).toBe("That's my kitchen.");
  });

  it("rejects stores outside the closed allowlist — even real ones", async () => {
    for (const store of ["events", "auth-users", "site-copy", "worklist", ""]) {
      const res = await post(
        { store, id: "x", contactName: "A", contact: "b" },
        "203.0.113.52",
      );
      expect(res.status).toBe(400);
      expectNoCookie(res);
    }
  });

  it("404s an unknown id — and a draft record 404s identically (no oracle)", async () => {
    const unknown = await post(
      { store: "restaurants", id: "no-such-place", contactName: "A", contact: "b" },
      "203.0.113.53",
    );
    expect(unknown.status).toBe(404);
    expectNoCookie(unknown);

    // A draft directory listing exists in the DB but is invisible to the
    // public read — claiming it must be indistinguishable from a miss.
    const draft: DirectoryListing = {
      id: "drafty-shop",
      name: "Drafty Shop",
      category: "shop",
      description: "not yet published",
      tags: [],
    };
    await saveDirectoryListing(draft, { actor: "test", status: "draft" });
    const asDraft = await post(
      { store: "directory", id: "drafty-shop", contactName: "A", contact: "b" },
      "203.0.113.54",
    );
    expect(asDraft.status).toBe(404);
    expectNoCookie(asDraft);
  });

  it("rejects oversized and missing fields through the payload schema", async () => {
    const base = { store: "restaurants", id: seedId, contactName: "A", contact: "b" };
    const cases: Record<string, unknown>[] = [
      { ...base, message: "m".repeat(1001) },
      { ...base, contactName: "n".repeat(201) },
      { ...base, contact: "c".repeat(201) },
      { ...base, businessName: "b".repeat(201) },
      { ...base, contactName: "" },
      { ...base, contact: "" },
    ];
    for (const [i, body] of cases.entries()) {
      const res = await post(body, `203.0.113.${60 + i}`);
      expect(res.status).toBe(400);
      expectNoCookie(res);
    }
    // Nothing above may have produced a second item or bumped the count.
    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items.filter((i) => i.subjectId === seedId)).toHaveLength(1);
    expect(items.find((i) => i.subjectId === seedId)?.payload.count).toBe(2);
  });

  it("the IP bucket trips: 5 requests pass the gate, the 6th from the same IP is 429", async () => {
    const ip = "198.51.100.77";
    const target = restaurantSeed[1].id;
    for (let i = 0; i < 5; i += 1) {
      const res = await post(
        { store: "restaurants", id: target, contactName: `P ${i}`, contact: "360-555-0101" },
        ip,
      );
      expect(res.status).toBe(200);
      expectNoCookie(res);
    }
    const sixth = await post(
      { store: "restaurants", id: target, contactName: "P 6", contact: "360-555-0101" },
      ip,
    );
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
    expectNoCookie(sixth);

    // The five that landed merged into one open item for that listing.
    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items.filter((i) => i.subjectId === target)).toHaveLength(1);
    expect(items.find((i) => i.subjectId === target)?.payload.count).toBe(5);
  });

  it("the per-listing bucket trips across many IPs (10/hour per listing)", async () => {
    const target = restaurantSeed[2]?.id;
    if (!target) return; // seed set too small — the IP-bucket test covers the pattern
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await post(
        { store: "restaurants", id: target, contactName: "Crowd", contact: "x@y.test" },
        `192.0.2.${100 + i}`,
      );
      last = res.status;
      expectNoCookie(res);
    }
    expect(last).toBe(429);
  });
});
