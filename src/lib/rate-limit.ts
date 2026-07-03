// In-process rate limiter for the auth write endpoints (login, first-run
// setup, invite redeem). Guards scrypt password hashes and invite codes
// against brute-force / enumeration by capping attempts per key per window.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ IMPORTANT — this is PER-INSTANCE memory.                               │
// │                                                                        │
// │ The window state lives in a module-level Map in THIS process. On a     │
// │ single persistent-disk server (Render/Fly/Railway/VPS with one         │
// │ instance) that is exactly right and needs nothing else.                │
// │                                                                        │
// │ It will NOT limit across replicas or serverless lambdas: each          │
// │ instance/invocation keeps its own counters, so N instances multiply    │
// │ the effective limit by N (and short-lived lambdas reset it every       │
// │ cold start). When this app moves to Vercel or scales past one          │
// │ instance, back this with a shared store (Upstash Redis, or the         │
// │ platform's KV) — keep this file's function signatures identical and    │
// │ swap only the Map read/write for a Redis sorted-set / INCR+EXPIRE.     │
// │ This module is the clean seam for that swap; callers never change.     │
// └──────────────────────────────────────────────────────────────────────┘

/** Recent attempt timestamps (ms) per key. Pruned lazily on each check. */
const hits = new Map<string, number[]>();

/** Default: 8 attempts per rolling 60s window. */
const DEFAULT_LIMIT = 8;
const DEFAULT_WINDOW_MS = 60_000;

// Keep the Map from growing unbounded under a spray of distinct keys: every so
// often, drop keys whose newest timestamp has fully aged out of any plausible
// window. Cheap, amortized, and bounded by how often we actually get called.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const horizon = now - windowMs;
  for (const [key, times] of hits) {
    if (times.length === 0 || times[times.length - 1] <= horizon) {
      hits.delete(key);
    }
  }
}

export interface RateLimitResult {
  /** true when the attempt is allowed; false when the limit is exceeded. */
  ok: boolean;
  /** Seconds until the caller may retry (0 when ok). Suitable for Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Record an attempt for `key` and report whether it is within the limit.
 *
 * Sliding window: we keep the timestamps of attempts inside the last
 * `windowMs` and allow up to `limit` of them. The current attempt counts
 * toward the limit — i.e. the (limit + 1)-th attempt in a window is rejected.
 */
export function checkRateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): RateLimitResult {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();
  const windowStart = now - windowMs;

  sweep(now, windowMs);

  // Prune this key's attempts down to those still inside the window.
  const previous = hits.get(key);
  const recent = previous ? previous.filter((t) => t > windowStart) : [];

  if (recent.length >= limit) {
    // Rejected: don't record this attempt (so a flood can't push the retry
    // time forward forever). Retry is possible once the oldest attempt ages
    // out of the window.
    hits.set(key, recent);
    const oldest = recent[0];
    const retryAfterMs = oldest + windowMs - now;
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Derive a rate-limit key from a logical `bucket` (e.g. "login") plus the
 * client's IP. Reads the first hop of `x-forwarded-for`, then `x-real-ip`,
 * falling back to "unknown" when neither is present.
 *
 * Note: behind a proxy that does NOT strip client-supplied XFF, the first hop
 * can be spoofed. On the intended persistent-disk deploys the platform proxy
 * (Render/Fly/Railway/nginx) sets a trustworthy XFF, so the first hop is the
 * real client. The per-account buckets (login:<email>, redeem:<code>) add a
 * second dimension that spoofing the IP can't escape.
 */
export function clientKey(request: Request, bucket: string): string {
  const xff = request.headers.get("x-forwarded-for");
  const firstHop = xff?.split(",")[0]?.trim();
  const ip = firstHop || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `${bucket}:${ip}`;
}
