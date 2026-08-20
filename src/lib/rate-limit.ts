// Rate limiter for the auth write endpoints (login, first-run setup, invite
// redeem). Guards scrypt password hashes and invite codes against
// brute-force / enumeration by capping attempts per key per window.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ TWO BACKENDS, ONE SEAM.                                                 │
// │                                                                        │
// │ • Upstash Redis (when UPSTASH_REDIS_REST_URL is set): a SHARED sliding │
// │   window that limits correctly across replicas and serverless lambdas. │
// │   This is the path used on Vercel.                                     │
// │                                                                        │
// │ • In-process Map (fallback, no Upstash env): PER-INSTANCE memory. On a  │
// │   single persistent-disk server (Render/Fly/Railway/VPS with one       │
// │   instance) that is exactly right. It will NOT limit across replicas   │
// │   or short-lived lambdas — each keeps its own counters — so it is only  │
// │   the local-dev / single-instance fallback.                            │
// │                                                                        │
// │ checkRateLimit is async; both branches are awaitable behind it. The    │
// │ exported function signatures and RateLimitResult shape are identical   │
// │ across backends, so callers never change.                              │
// └──────────────────────────────────────────────────────────────────────┘

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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

/** True when Upstash Redis env is configured (Vercel / multi-instance). */
function hasUpstash(): boolean {
  return !!process.env.UPSTASH_REDIS_REST_URL;
}

// One shared Redis client and a cache of Ratelimit instances. Building a
// Ratelimit is cheap but not free, and enabling its ephemeral cache only pays
// off when the instance outlives a single request — so we memoize per window.
let redis: Redis | undefined;
const limiters = new Map<string, Ratelimit>();

function ratelimiterFor(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  let rl = limiters.get(cacheKey);
  if (!rl) {
    redis ??= Redis.fromEnv();
    // slidingWindow to match the in-memory algorithm. Express the window in ms
    // so an arbitrary per-call override maps exactly; the default 60_000ms is
    // equivalent to the "60 s" default window.
    const window = `${windowMs} ms` as Duration;
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      // Namespace so these keys can't collide with anything else in the DB.
      prefix: "rl",
    });
    limiters.set(cacheKey, rl);
  }
  return rl;
}

async function checkUpstash(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { success, reset } = await ratelimiterFor(limit, windowMs).limit(key);
  if (success) return { ok: true, retryAfterSeconds: 0 };
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}

/**
 * In-process sliding window: keep the timestamps of attempts inside the last
 * `windowMs` and allow up to `limit` of them. The current attempt counts
 * toward the limit — i.e. the (limit + 1)-th attempt in a window is rejected.
 */
function checkInMemory(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
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
 * Record an attempt for `key` and report whether it is within the limit.
 * Uses shared Upstash Redis when configured, otherwise an in-process Map.
 */
export async function checkRateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): Promise<RateLimitResult> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;

  if (hasUpstash()) {
    return checkUpstash(key, limit, windowMs);
  }
  return checkInMemory(key, limit, windowMs);
}

/**
 * Derive a rate-limit key from a logical `bucket` (e.g. "login") plus the
 * client's IP, most-trusted source first:
 *
 *   1. `cf-connecting-ip`, then `true-client-ip`. Both prod hosts (the
 *      .onrender.com domain and the custom domain) serve via Cloudflare in
 *      front of Render — verified live: `server: cloudflare` +
 *      `x-render-origin-server: Render` on both — and that edge writes these
 *      single-value headers itself, replacing anything the client sent. A
 *      request cannot reach the service without passing through it.
 *
 *   2. The RIGHTMOST hop of `x-forwarded-for`. Proxies APPEND to XFF rather
 *      than replace it, so hops the client made up arrive on the left and only
 *      the rightmost value was written by the edge in front of us. Never read
 *      the leftmost hop: it lets a caller mint a fresh key per request (an
 *      unlimited supply of buckets) or pin the blame on someone else's IP.
 *      Worst case the rightmost hop names an internal proxy rather than the
 *      end client — that pools clients into one bucket, which is tighter,
 *      never looser.
 *
 *   3. `x-real-ip`, then "unknown" — direct connections: local dev and tests.
 *
 * On the live deploy branch 1 always fires; the rest exist for dev and any
 * future re-hosting. The per-account buckets (login:<email>, redeem:<code>)
 * add a second dimension that a rotated or shared IP can't escape.
 */
export function clientKey(request: Request, bucket: string): string {
  const platform =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("true-client-ip")?.trim();
  if (platform) return `${bucket}:${platform}`;

  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const lastHop = hops.length > 0 ? hops[hops.length - 1] : undefined;
  const ip = lastHop || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `${bucket}:${ip}`;
}
