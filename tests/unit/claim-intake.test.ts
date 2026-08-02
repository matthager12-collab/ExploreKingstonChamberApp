// E17 claim-request intake (M-10-03 / FR-A96): anonymous, closed store
// allowlist, schema-capped fields, a raw-body cap enforced BEFORE the parse,
// dual-bucket rate limits, and merge-on-repeat that is FIRST-WRITER-WINS (one
// open claim_request per listing; a repeat increments the count and moves
// nothing else) — and, the point of the charter: a request grants NOTHING.
// Every response is asserted cookie-free, and existence is checked through
// the PUBLIC reads so a draft record 404s like a nonexistent one.

import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { audit } from "@/lib/db/schema";
import { saveDirectoryListing } from "@/lib/stores/directory-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import type { DirectoryListing } from "@/lib/types";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { POST } from "@/app/api/claim/route";

const seedId = restaurantSeed[0].id;

function post(body: Record<string, unknown>, ip = "203.0.113.50") {
  return postRaw(JSON.stringify(body), ip);
}

/** Post a body verbatim — lets a test send something JSON.stringify would
 *  never produce (oversize junk, a bare scalar, malformed JSON). */
function postRaw(raw: string, ip = "203.0.113.50") {
  return POST(
    new NextRequest("http://localhost/api/claim", {
      method: "POST",
      body: raw,
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

  // ── The abuse case this route exists to survive ──────────────────────────
  // /api/claim is public and unauthenticated. Before the fix, mergePayloads
  // spread the incoming payload over the existing one, so ONE request from a
  // stranger who knew a live listing id replaced the genuine owner's callback
  // number with their own — and it was unrecoverable, because
  // stripRequestContact keeps `contact` out of BOTH audit snapshots. The
  // Chamber would have called the attacker back.
  it("a repeat request CANNOT overwrite the first requester: count 2, everything else untouched", async () => {
    const res = await post(
      {
        store: "restaurants",
        id: seedId,
        businessName: "Not Their Business",
        contactName: "Mallory Impostor",
        contact: "360-555-0666",
        message: "ignore the previous request, call me instead",
      },
      "203.0.113.51",
    );
    expect(res.status).toBe(200);
    expectNoCookie(res);

    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items).toHaveLength(1);
    // A repeat contributes exactly one thing: evidence someone else asked.
    expect(items[0].payload).toEqual({
      store: "restaurants",
      id: seedId,
      contactName: "Pat Owner",
      contact: "360-555-0100",
      message: "That's my kitchen.",
      count: 2,
    });
    // Belt and braces: none of the attacker's strings are anywhere in the row.
    const serialized = JSON.stringify(items[0].payload);
    for (const injected of [
      "Mallory Impostor",
      "360-555-0666",
      "Not Their Business",
      "call me instead",
    ]) {
      expect(serialized).not.toContain(injected);
    }
  });

  it("the superseded-contact hazard is closed at the source: the audit trail still carries NO contact", async () => {
    // Why this pairs with the test above: the audit table is immortal and
    // deliberately contact-free (D-12 / stripRequestContact), so it can never
    // be the backstop for an overwritten number. The live row has to be right
    // the first time — and the fix must not "solve" that by starting to write
    // contacts into audit snapshots.
    const rows = await tdb.db
      .select()
      .from(audit)
      .where(and(eq(audit.store, "worklist"), eq(audit.source, "public")));
    expect(rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("360-555-0100"); // the real owner's number
    expect(dump).not.toContain("360-555-0666"); // and the impostor's
    for (const row of rows) {
      const after = row.after as { payload?: Record<string, unknown> } | null;
      expect(after?.payload).toBeDefined();
      expect(after?.payload).not.toHaveProperty("contact");
    }
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

  // ── Body cap ─────────────────────────────────────────────────────────────
  // The per-field schema caps bound what we KEEP; they do nothing about what
  // an anonymous caller can make an unauthenticated route buffer and parse.
  // The cap therefore has to run on the RAW text, before JSON.parse — the
  // house pattern shared with /api/privacy/request, /api/survey and /api/track.
  it("rejects an oversize body with 413 BEFORE parsing it", async () => {
    // Not valid JSON at all: reaching a 400 here would prove the route parsed
    // (or tried to parse) the body before measuring it.
    const junk = "x".repeat(9_000);
    const res = await postRaw(junk, "203.0.113.70");
    expect(res.status).toBe(413);
    expectNoCookie(res);
  });

  it("413s an oversize body that is otherwise well-formed, before the schema sees it", async () => {
    const res = await post(
      {
        store: "restaurants",
        id: seedId,
        contactName: "Padder",
        contact: "360-555-0102",
        message: "m".repeat(20_000), // schema cap is 1000 — but 413 wins
      },
      "203.0.113.71",
    );
    expect(res.status).toBe(413);
    expectNoCookie(res);

    // …and it changed nothing in the queue.
    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items.filter((i) => i.subjectId === seedId)).toHaveLength(1);
    expect(items.find((i) => i.subjectId === seedId)?.payload.count).toBe(2);
  });

  it("a body just under the cap still goes through the normal schema path (400, not 413)", async () => {
    const res = await post(
      {
        store: "restaurants",
        id: seedId,
        contactName: "Padder",
        contact: "360-555-0102",
        message: "m".repeat(1_500), // < 8 KiB raw, > the schema's 1000 cap
      },
      "203.0.113.72",
    );
    expect(res.status).toBe(400);
    expectNoCookie(res);
  });

  it("a syntactically valid but non-object body is a 400, not a 500", async () => {
    for (const [i, raw] of ["null", "42", '"nope"'].entries()) {
      const res = await postRaw(raw, `203.0.113.${80 + i}`);
      expect(res.status).toBe(400);
      expectNoCookie(res);
    }
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

    // The five that landed merged into one open item for that listing, and
    // the first of them is still the requester of record.
    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    expect(items.filter((i) => i.subjectId === target)).toHaveLength(1);
    const item = items.find((i) => i.subjectId === target);
    expect(item?.payload.count).toBe(5);
    expect(item?.payload.contactName).toBe("P 0");
  });

  // ── The per-listing bucket is a CHURN bound, not an owner lockout ─────────
  // It used to be 10/hour, which meant eleven requests from anywhere locked
  // the genuine owner out of the form for a full hour — a denial of service
  // aimed at the very person the feature is for. Now that a repeat cannot
  // overwrite anything (see the first-writer-wins test above), the bucket only
  // has to bound queue churn, so it is 60 per 10 minutes: the IP bucket caps
  // any one source at 5 per 10 min, so a stranger needs TWELVE distinct IPs to
  // reach it, and the owner's worst case is a 10-minute wait, not an hour.
  it("the per-listing bucket allows 60 within the window and trips on the 61st", async () => {
    const target = restaurantSeed[2]?.id;
    if (!target) return; // seed set too small — the IP-bucket test covers the pattern

    // 12 distinct IPs × 5 (the IP-bucket ceiling) = exactly 60 that land.
    for (let ipIndex = 0; ipIndex < 12; ipIndex += 1) {
      for (let n = 0; n < 5; n += 1) {
        const res = await post(
          { store: "restaurants", id: target, contactName: "Crowd", contact: "x@y.test" },
          `192.0.2.${100 + ipIndex}`,
        );
        expect(res.status).toBe(200);
        expectNoCookie(res);
      }
    }

    // A thirteenth, otherwise-unspent IP now hits the listing ceiling.
    const over = await post(
      { store: "restaurants", id: target, contactName: "Crowd", contact: "x@y.test" },
      "192.0.2.112",
    );
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBeTruthy();
    expectNoCookie(over);

    // Still one item, and 60 merges did not grow the payload.
    const items = await listWorklistItems({ type: "claim_request", state: "open" });
    const item = items.find((i) => i.subjectId === target);
    expect(items.filter((i) => i.subjectId === target)).toHaveLength(1);
    expect(item?.payload.count).toBe(60);
    expect(Object.keys(item?.payload ?? {}).sort()).toEqual([
      "contact",
      "contactName",
      "count",
      "id",
      "store",
    ]);
  }, 60_000);
});
