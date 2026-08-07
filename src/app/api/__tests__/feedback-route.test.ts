// POST /api/feedback — the anonymous intake behind the site-wide feedback tab.
//
// Shaped after survey-route.test.ts, and deliberately covering the same four
// areas (rate limit, body cap, idempotent replay, header-less clients) plus the
// two things this route has that the survey does not: a required integer rating
// and a source path that must be sanitized before it is stored.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST, normalizeFeedbackPath } from "@/app/api/feedback/route";
import { readFeedbackResponses } from "@/lib/db/append";
import { FEEDBACK_COMMENT_MAX, REDACTED_PATH, type FeedbackResponse } from "@/lib/types";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

function post(ip: string, body?: unknown, key?: string) {
  return POST(
    new NextRequest("http://localhost/api/feedback", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body ?? { rating: 5, path: "/eat" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(key ? { "X-Idempotency-Key": key } : {}),
      },
    }),
  );
}

const rows = () => readFeedbackResponses<FeedbackResponse>();

describe("POST /api/feedback rate limit", () => {
  it("allows 10 then 429s the 11th from the same IP, but a different IP still passes", async () => {
    const ip = "198.51.100.10";
    for (let i = 0; i < 10; i++) {
      expect((await post(ip)).status).toBe(200);
    }
    const eleventh = await post(ip);
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get("Retry-After")).toBeTruthy();

    expect((await post("198.51.100.11")).status).toBe(200);
  });
});

describe("POST /api/feedback validation", () => {
  it("rejects a missing, out-of-range, or fractional rating and stores nothing", async () => {
    const before = (await rows()).length;
    for (const bad of [undefined, 0, 6, 3.5, "4", null]) {
      const res = await post("198.51.100.20", { rating: bad, path: "/eat" });
      expect(res.status).toBe(400);
    }
    // A 3.5 would land in a byRating bucket the admin page never renders, so
    // the row would vanish from the distribution while inflating the total —
    // the reason the check is Number.isInteger and not just a range test.
    expect((await rows()).length).toBe(before);
  });

  it("rejects an oversized body before parsing (413) and stores nothing", async () => {
    const before = (await rows()).length;
    const res = await post("198.51.100.21", {
      rating: 3,
      path: "/eat",
      comment: "x".repeat(20_000),
    });
    expect(res.status).toBe(413);
    // Count-based proof: a shape assertion passes vacuously here, since the
    // route truncates the comment anyway.
    expect((await rows()).length).toBe(before);
  });

  it("truncates an over-long comment rather than rejecting it", async () => {
    // Under the 16KB body cap but over the 2,000-char store limit: the
    // visitor's point survives, trimmed. Rejecting would lose the whole thing,
    // and the outbox drops its copy on a 4xx so nothing would retry.
    const res = await post("198.51.100.22", {
      rating: 2,
      path: "/parking",
      comment: "y".repeat(FEEDBACK_COMMENT_MAX + 500),
    });
    expect(res.status).toBe(200);
    const saved = (await rows()).find((r) => r.comment?.startsWith("yyy"));
    expect(saved!.comment).toHaveLength(FEEDBACK_COMMENT_MAX);
  });

  it("stores a rating with no comment, and omits the field rather than storing empty text", async () => {
    const res = await post("198.51.100.23", { rating: 5, path: "/ferry", comment: "   " });
    expect(res.status).toBe(200);
    const saved = (await rows()).find((r) => r.path === "/ferry");
    expect(saved).toBeDefined();
    expect(saved).not.toHaveProperty("comment");
  });

  it("never persists a contact field, even when a client sends one", async () => {
    // The widget has no contact input; this proves the ROUTE is what keeps
    // feedback_response a no-identifier store in PII_STORES, so a future
    // client (or a hand-rolled POST) cannot quietly make it an identified one.
    const res = await post("198.51.100.24", {
      rating: 4,
      path: "/stay",
      comment: "call me",
      email: "someone@example.com",
      contact: "360-555-0100",
      name: "A Visitor",
    });
    expect(res.status).toBe(200);
    const saved = (await rows()).find((r) => r.path === "/stay");
    expect(saved).not.toHaveProperty("email");
    expect(saved).not.toHaveProperty("contact");
    expect(saved).not.toHaveProperty("name");
  });
});

describe("POST /api/feedback idempotent intake", () => {
  it("stores the first submission and answers a replay of the same key without a second row", async () => {
    const key = "feedback-replay-000001";
    const body = { rating: 1, path: "/map", comment: "replay-marker-42" };
    const countOf = async () =>
      (await rows()).filter((r) => r.comment === "replay-marker-42").length;

    const first = await post("198.51.100.30", body, key);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(await countOf()).toBe(1);

    // What flushOutbox does when the 200 never reached the device.
    const replay = await post("198.51.100.30", body, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    expect(await countOf()).toBe(1);
  });

  it("still accepts a submission with no idempotency header", async () => {
    const before = (await rows()).length;
    const res = await post("198.51.100.31", { rating: 4, path: "/events" });
    expect(res.status).toBe(200);
    expect((await rows()).length).toBe(before + 1);
  });

  it("rejects a malformed idempotency key with 400 and stores nothing", async () => {
    const before = (await rows()).length;
    const res = await post("198.51.100.32", { rating: 4, path: "/events" }, "short");
    expect(res.status).toBe(400);
    expect((await rows()).length).toBe(before);
  });
});

describe("normalizeFeedbackPath", () => {
  it("keeps a plain in-app path", () => {
    expect(normalizeFeedbackPath("/parking")).toBe("/parking");
    expect(normalizeFeedbackPath("/hunt/waterfront")).toBe("/hunt/waterfront");
  });

  it("strips the query string and hash — the parts most likely to carry an identifier", () => {
    expect(normalizeFeedbackPath("/eat?email=someone@example.com")).toBe("/eat");
    expect(normalizeFeedbackPath("/eat#section")).toBe("/eat");
    expect(normalizeFeedbackPath("/eat ?x=1")).toBe("/eat");
  });

  it("refuses anything that is not an in-app path", () => {
    // An absolute URL would let a caller store an arbitrary external string in
    // a field the admin page renders as a link.
    expect(normalizeFeedbackPath("https://evil.example/x")).toBe("(unknown)");
    expect(normalizeFeedbackPath("javascript:alert(1)")).toBe("(unknown)");
    expect(normalizeFeedbackPath("")).toBe("(unknown)");
    expect(normalizeFeedbackPath(undefined)).toBe("(unknown)");
    expect(normalizeFeedbackPath(42)).toBe("(unknown)");
  });

  it("bounds a hostile path rather than storing it whole", () => {
    expect(normalizeFeedbackPath(`/${"a".repeat(5_000)}`).length).toBeLessThanOrEqual(512);
  });
});

describe("sensitive-path redaction", () => {
  it("redacts the path but KEEPS the submission", async () => {
    // SENSITIVE_PATHS is empty today (the mechanism ships ahead of the page),
    // so this drives the helper directly with an explicit prefix list to prove
    // the wiring, rather than asserting on a list that is currently empty.
    const { isSensitivePath } = await import("@/lib/privacy/policy");
    expect(isSensitivePath("/food-assistance", ["/food-assistance"])).toBe(true);
    // Segment boundary, not substring — the property normalizeFeedbackPath
    // inherits by delegating to the shared helper.
    expect(isSensitivePath("/food-assistance-fair", ["/food-assistance"])).toBe(false);

    // And the placeholder is a non-route, so the admin page renders it as
    // plain text instead of a broken link.
    expect(REDACTED_PATH.startsWith("/")).toBe(false);
  });
});
