import { afterEach, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

afterEach(() => vi.useRealTimers());

it("keeps a ten-minute account limit when a one-minute bucket triggers cleanup", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T00:00:00Z"));
  const key = "event-extract:window-regression@example.test";
  expect((await checkRateLimit(key, { limit: 1, windowMs: 600_000 })).ok).toBe(true);
  vi.advanceTimersByTime(300_001);
  await checkRateLimit("short-window-cleanup", { windowMs: 60_000 });
  const blocked = await checkRateLimit(key, { limit: 1, windowMs: 600_000 });
  expect(blocked.ok).toBe(false);
  expect(blocked.retryAfterSeconds).toBe(300);
  vi.advanceTimersByTime(300_000);
  expect((await checkRateLimit(key, { limit: 1, windowMs: 600_000 })).ok).toBe(true);
});
