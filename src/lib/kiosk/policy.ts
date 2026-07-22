// The kiosk's unattended-operation policies, as PURE functions.
//
// Extracted from KioskShell so vitest can drive every one of them with fake
// timers and plain arithmetic (tests/unit/kiosk-shell-timers.test.ts). The
// behaviours these encode — when to reload, when to admit the network is gone,
// how far to nudge the pixels — only ever misbehave on a device that has been
// running for days, which is the exact situation nobody can reproduce by hand.

/**
 * Minimum gap between two self-heal reloads.
 *
 * THE FAILURE THIS PREVENTS: a render error that reproduces on load. Without a
 * floor, the error handler reloads, the reload errors, and the panel becomes a
 * reboot loop flashing at people on the dock — worse than the frozen screen it
 * was trying to fix, and it hammers the server while doing it.
 */
export const RELOAD_DEBOUNCE_MS = 30_000;

/** How often the shell asks /api/health whether the app is still there. */
export const HEARTBEAT_MS = 60_000;

/**
 * Consecutive heartbeat failures before the kiosk SAYS it is offline.
 *
 * Three, at a 60s heartbeat, means roughly three minutes of confirmed silence
 * before the visible state changes. A single failed fetch is a Wi-Fi hiccup, a
 * DHCP renew, or a deploy swapping containers — all things that fix themselves
 * within seconds, and none of which should put "Be right back" in front of a
 * visitor who could have read the ferry times perfectly well.
 */
export const HEARTBEAT_FAILURES_BEFORE_DEGRADED = 3;

/**
 * How often an idle kiosk reloads itself to pick up content changes.
 *
 * Fifteen minutes. This is the belt to ISR's braces: it also flushes whatever
 * memory a browser has accumulated over days of uptime, which is the real
 * reason it exists — content freshness alone is already handled server-side.
 * Only ever fired while the attract loop is up, so it can never yank a page
 * out from under someone mid-read.
 */
export const FRESHNESS_RELOAD_MS = 15 * 60_000;

/** How often the stage shifts a pixel or two to defeat burn-in. */
export const NUDGE_INTERVAL_MS = 30 * 60_000;

/** Largest offset the nudge will ever apply, in stage pixels. */
export const NUDGE_MAX_PX = 2;

/**
 * May a self-heal reload fire now?
 *
 * `lastReloadAt` is null when none has happened this page-life. Callers pass
 * the clock explicitly so tests do not have to fake Date.
 */
export function canReload(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null) return true;
  return now - lastReloadAt >= RELOAD_DEBOUNCE_MS;
}

/** Has the network been down long enough to admit it on screen? */
export function isDegraded(consecutiveFailures: number): boolean {
  return consecutiveFailures >= HEARTBEAT_FAILURES_BEFORE_DEGRADED;
}

/**
 * Next burn-in offset, cycling deterministically through the four corners of a
 * small square rather than drifting or randomising.
 *
 * Deterministic on purpose: a random walk can sit in one place for hours by
 * chance, which is precisely the thing being defended against, and Math.random
 * in a component makes the render impure. Four steps of at most two pixels are
 * invisible to a person and enough to keep any given LCD sub-pixel from holding
 * one value for the life of the panel.
 */
export function nextNudge(step: number): { x: number; y: number } {
  const corners = [
    { x: 0, y: 0 },
    { x: NUDGE_MAX_PX, y: 0 },
    { x: NUDGE_MAX_PX, y: NUDGE_MAX_PX },
    { x: 0, y: NUDGE_MAX_PX },
  ];
  return corners[step % corners.length];
}

/**
 * A kiosk-scoped analytics session id.
 *
 * Rotated on every idle reset, which is what makes kiosk numbers mean anything:
 * the site's id lives in sessionStorage and would never change on a panel that
 * runs for weeks, folding a whole summer of walk-ups into one "visitor". The
 * vk-kiosk- prefix is what analytics-store keys the separate series on.
 *
 * `rand` is injected so tests are deterministic; production passes Math.random.
 */
export function newKioskSessionId(rand: () => number = Math.random): string {
  return `vk-kiosk-${Math.floor(rand() * 0xffffffff).toString(36)}${Math.floor(rand() * 0xffffffff).toString(36)}`;
}
