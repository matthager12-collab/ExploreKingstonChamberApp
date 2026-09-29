// The in-memory limiter keeps every caller's counters in one Map, and callers
// use different windows: 60 seconds for logins, ten minutes for feedback and
// sign-ups, an hour for the per-inbox cap on claim codes. The sweep that trims
// the Map used the window of WHOEVER HAPPENED TO CALL, so a login (60 seconds)
// deleted an hour bucket that was still live. Render runs this fallback in
// production (UPSTASH_* is unset there, docs/DEPLOY.md), so a cap of 3 emails an
// hour to one inbox lapsed after a few minutes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter keeps its Map and its last-sweep time at module level, so each
// test loads a fresh copy: otherwise one test's sweep decides whether the next
// test's sweep runs at all.
async function load() {
  return (await import("@/lib/rate-limit")).checkRateLimit;
}

beforeEach(() => {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const HOUR = { limit: 3, windowMs: 60 * 60_000 };
const TEN_MIN = { limit: 12, windowMs: 10 * 60_000 };
const at = (iso: string) => vi.setSystemTime(new Date(iso));

describe("in-memory limiter with mixed windows", () => {
  it("a short-window caller's sweep does not clear an hour bucket that is still live", async () => {
    const checkRateLimit = await load();
    const key = "email:victim-a@example.test";
    for (let i = 0; i < 3; i++) expect((await checkRateLimit(key, HOUR)).ok).toBe(true);
    expect((await checkRateLimit(key, HOUR)).ok).toBe(false);

    at("2026-09-28T12:06:00Z"); // six minutes on, still inside the hour
    await checkRateLimit("login:someone"); // default 60 s window; this call runs the sweep
    expect((await checkRateLimit(key, HOUR)).ok).toBe(false);
  });

  it("a ten-minute bucket survives a sixty-second caller's sweep", async () => {
    const checkRateLimit = await load();
    const key = "event-extract:a@example.test";
    for (let i = 0; i < 12; i++) await checkRateLimit(key, TEN_MIN);
    expect((await checkRateLimit(key, TEN_MIN)).ok).toBe(false);

    at("2026-09-28T12:06:00Z");
    await checkRateLimit("login:someone-else");
    expect((await checkRateLimit(key, TEN_MIN)).ok).toBe(false);
  });

  // The fix must not turn the Map into a leak or a lock: a bucket still expires
  // on ITS OWN window.
  it("an hour bucket is open again once its own hour has passed", async () => {
    const checkRateLimit = await load();
    const key = "email:victim-b@example.test";
    for (let i = 0; i < 3; i++) await checkRateLimit(key, HOUR);
    expect((await checkRateLimit(key, HOUR)).ok).toBe(false);

    at("2026-09-28T13:01:00Z"); // sixty-one minutes later
    await checkRateLimit("login:third");
    expect((await checkRateLimit(key, HOUR)).ok).toBe(true);
  });

  it("the sixty-second default still lapses after sixty seconds", async () => {
    const checkRateLimit = await load();
    const key = "login:fresh";
    for (let i = 0; i < 8; i++) expect((await checkRateLimit(key)).ok).toBe(true);
    expect((await checkRateLimit(key)).ok).toBe(false);

    at("2026-09-28T12:01:01Z");
    expect((await checkRateLimit(key)).ok).toBe(true);
  });

  it("reports how long to wait against the bucket's own window", async () => {
    const checkRateLimit = await load();
    const key = "email:victim-c@example.test";
    for (let i = 0; i < 3; i++) await checkRateLimit(key, HOUR);
    at("2026-09-28T12:20:00Z");
    await checkRateLimit("login:other");
    const refused = await checkRateLimit(key, HOUR);
    expect(refused.ok).toBe(false);
    // First hit was at 12:00, so the hour is up at 13:00: 40 minutes from now.
    expect(refused.retryAfterSeconds).toBe(40 * 60);
  });
});
