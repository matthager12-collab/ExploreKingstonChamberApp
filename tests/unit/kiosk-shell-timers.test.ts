// KioskShell's unattended-operation policies (E22).
//
// These are the behaviours that only ever misbehave on a device that has been
// running for days at a ferry dock, which is exactly the situation nobody can
// reproduce by hand before shipping. They live in src/lib/kiosk/policy.ts as
// pure functions precisely so they can be driven here with arithmetic and fake
// timers instead of a wall-mounted panel and a week.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canReload,
  isDegraded,
  newKioskSessionId,
  nextNudge,
  FRESHNESS_RELOAD_MS,
  HEARTBEAT_FAILURES_BEFORE_DEGRADED,
  HEARTBEAT_MS,
  NUDGE_INTERVAL_MS,
  NUDGE_MAX_PX,
  RELOAD_DEBOUNCE_MS,
} from "@/lib/kiosk/policy";
import {
  clampIdleSeconds,
  DEFAULT_IDLE_SECONDS,
  MAX_IDLE_SECONDS,
  MIN_IDLE_SECONDS,
} from "@/lib/kiosk/limits";

describe("self-heal reload debounce", () => {
  it("allows the first reload of a page life", () => {
    expect(canReload(null, 1_000_000)).toBe(true);
  });

  it("REFUSES a second reload inside the debounce window", () => {
    // The failure this prevents: a render error that reproduces on load. Without
    // the floor the handler reloads, the reload errors, and the panel becomes a
    // reboot loop flashing at people on the dock while hammering the server.
    const t0 = 1_000_000;
    expect(canReload(t0, t0 + 1)).toBe(false);
    expect(canReload(t0, t0 + RELOAD_DEBOUNCE_MS - 1)).toBe(false);
  });

  it("allows one again exactly at the window edge", () => {
    const t0 = 1_000_000;
    expect(canReload(t0, t0 + RELOAD_DEBOUNCE_MS)).toBe(true);
  });

  it("caps a permanently-failing page at 2 reloads a minute", () => {
    // Drive a full minute of continuous errors and count how many get through.
    let last: number | null = null;
    let reloads = 0;
    for (let now = 0; now <= 60_000; now += 250) {
      if (canReload(last, now)) {
        reloads++;
        last = now;
      }
    }
    expect(reloads).toBeLessThanOrEqual(3);
  });
});

describe("heartbeat / degraded state", () => {
  it("does not cry offline over a single failed beat", () => {
    // One failed fetch is a Wi-Fi hiccup, a DHCP renew, or a deploy swapping
    // containers — all self-healing within seconds. Putting "Be right back" in
    // front of somebody who could have read the ferry times is the wrong trade.
    expect(isDegraded(0)).toBe(false);
    expect(isDegraded(1)).toBe(false);
  });

  it("admits it after the configured run of consecutive failures", () => {
    expect(isDegraded(HEARTBEAT_FAILURES_BEFORE_DEGRADED)).toBe(true);
    expect(isDegraded(HEARTBEAT_FAILURES_BEFORE_DEGRADED + 5)).toBe(true);
  });

  it("waits minutes, not seconds, before changing what is on screen", () => {
    // The property that actually matters to a visitor, stated in time rather
    // than in beats, so tuning HEARTBEAT_MS cannot silently make it twitchy.
    const msBeforeAdmitting = HEARTBEAT_MS * HEARTBEAT_FAILURES_BEFORE_DEGRADED;
    expect(msBeforeAdmitting).toBeGreaterThanOrEqual(120_000);
  });
});

describe("burn-in nudge", () => {
  it("stays within a couple of pixels", () => {
    for (let step = 0; step < 20; step++) {
      const { x, y } = nextNudge(step);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(NUDGE_MAX_PX);
      expect(y).toBeLessThanOrEqual(NUDGE_MAX_PX);
    }
  });

  it("visits every corner and never sits still", () => {
    // A random walk can sit in one place for hours by chance, which is the
    // exact thing being defended against. This one cycles deterministically.
    const seen = new Set([0, 1, 2, 3].map((s) => JSON.stringify(nextNudge(s))));
    expect(seen.size).toBe(4);
    for (let s = 0; s < 8; s++) {
      expect(nextNudge(s)).not.toEqual(nextNudge(s + 1));
    }
  });

  it("cycles at the same offsets after a full lap", () => {
    expect(nextNudge(9)).toEqual(nextNudge(1));
  });
});

describe("kiosk session ids", () => {
  it("carries the prefix the analytics split keys on", () => {
    // analytics-store separates the kiosk series on the event's `source`, but
    // the prefix is what makes a stray row recognisable by eye in the store.
    expect(newKioskSessionId(() => 0.5)).toMatch(/^vk-kiosk-/);
  });

  it("produces a different id per walk-up", () => {
    // Rotated on every idle reset. Without this the panel reports one
    // "visitor" for the life of the device and the kiosk numbers mean nothing.
    const ids = new Set(Array.from({ length: 200 }, () => newKioskSessionId()));
    expect(ids.size).toBeGreaterThan(190);
  });

  it("is deterministic when the randomness is injected (so tests can pin it)", () => {
    expect(newKioskSessionId(() => 0.25)).toBe(newKioskSessionId(() => 0.25));
  });
});

describe("idle timeout clamping", () => {
  it("keeps a junk value from configuring an unusable device", () => {
    // These land in an overlay record that a restore or a hand-edited import
    // could have written. 0 would reset the screen faster than anyone can read.
    expect(clampIdleSeconds(0)).toBe(MIN_IDLE_SECONDS);
    expect(clampIdleSeconds(-500)).toBe(MIN_IDLE_SECONDS);
    expect(clampIdleSeconds(999_999)).toBe(MAX_IDLE_SECONDS);
    expect(clampIdleSeconds("banana")).toBe(DEFAULT_IDLE_SECONDS);
    expect(clampIdleSeconds(null)).toBe(DEFAULT_IDLE_SECONDS);
    expect(clampIdleSeconds(undefined)).toBe(DEFAULT_IDLE_SECONDS);
    expect(clampIdleSeconds(NaN)).toBe(DEFAULT_IDLE_SECONDS);
  });

  it("passes a sensible value through, rounded", () => {
    expect(clampIdleSeconds(90)).toBe(90);
    expect(clampIdleSeconds(45.4)).toBe(45);
  });

  it("leaves a reader time to actually read", () => {
    expect(MIN_IDLE_SECONDS).toBeGreaterThanOrEqual(15);
  });
});

describe("timer intervals fire as scheduled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reloads for freshness on the configured cadence, not sooner", () => {
    const tick = vi.fn();
    const id = setInterval(tick, FRESHNESS_RELOAD_MS);
    vi.advanceTimersByTime(FRESHNESS_RELOAD_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    // Over a 12-hour trading day that is a bounded number of reloads, not a
    // busy loop — the reason this is minutes and not seconds.
    vi.advanceTimersByTime(12 * 60 * 60_000);
    expect(tick.mock.calls.length).toBeLessThan(60);
    clearInterval(id);
  });

  it("nudges on the half hour and clears cleanly", () => {
    const tick = vi.fn();
    const id = setInterval(tick, NUDGE_INTERVAL_MS);
    vi.advanceTimersByTime(NUDGE_INTERVAL_MS * 3);
    expect(tick).toHaveBeenCalledTimes(3);
    clearInterval(id);
    vi.advanceTimersByTime(NUDGE_INTERVAL_MS * 3);
    // StrictMode double-invokes effects; a timer that survives its cleanup is
    // how a component ends up with two of everything on a device that never
    // reloads.
    expect(tick).toHaveBeenCalledTimes(3);
  });
});
