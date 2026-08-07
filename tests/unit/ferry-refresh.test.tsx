// @vitest-environment jsdom

// The two halves of src/lib/ferry-refresh.ts, both written for a failure that
// only shows up on a tab nobody has touched since yesterday (reported
// 2026-08-07: a laptop left open overnight, ferry board frontmost, showing a
// confident "Done for today" with no warning).
//
// Neither half is reproducible by hand inside a working day, which is exactly
// why both are pure/driveable: isStaleDay() takes `nowMs` as an argument rather
// than reading the clock, and useWakeRefresh() is exercised with fake timers and
// synthesized events instead of a real sleeping machine.
//
// TZ is pinned to UTC by the `test` script, and every instant below is anchored
// to Pacific wall time via pacificWallTimeToISO — so these assertions are about
// Kingston's calendar day, not the runner's.

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isStaleDay, useWakeRefresh } from "@/lib/ferry-refresh";
import { pacificWallTimeToISO } from "@/lib/time";

const day = (d: string, hhmm: string) => pacificWallTimeToISO(d, hhmm);
const at = (d: string, hhmm: string) => Date.parse(day(d, hhmm));

describe("isStaleDay", () => {
  it("is false while the payload's own day is still running", () => {
    const sailings = [{ departs: day("2026-08-07", "06:20") }, { departs: day("2026-08-07", "21:05") }];
    // Evening of the same Kingston day: the last boat has gone, but "Done for
    // today" is the TRUTH here and must stay sayable.
    expect(isStaleDay(sailings, at("2026-08-07", "22:30"))).toBe(false);
  });

  it("is true once the day has rolled over — the overnight-tab case", () => {
    const sailings = [{ departs: day("2026-08-06", "06:20") }, { departs: day("2026-08-06", "21:05") }];
    expect(isStaleDay(sailings, at("2026-08-07", "07:15"))).toBe(true);
  });

  it("does NOT trip just after midnight on a payload that still holds tonight's late boat", () => {
    // WSF's "schedule today" runs past midnight — the last Edmonds sailing
    // leaves around 01:25. A payload fetched at 23:00 therefore legitimately
    // contains a sailing dated TOMORROW, and the boat it describes is still the
    // right answer at 00:30. This is why the comparison is strictly-before and
    // not "the newest sailing is not today".
    const sailings = [{ departs: day("2026-08-06", "21:05") }, { departs: day("2026-08-07", "01:25") }];
    expect(isStaleDay(sailings, at("2026-08-07", "00:30"))).toBe(false);
  });

  it("dates the payload by its NEWEST sailing, not its first", () => {
    const sailings = [{ departs: day("2026-08-06", "23:40") }, { departs: day("2026-08-07", "06:20") }];
    expect(isStaleDay(sailings, at("2026-08-07", "09:00"))).toBe(false);
  });

  it("returns false for an empty payload rather than inventing a claim", () => {
    // Nothing to date it by. The schedule-only badge and the "live times
    // unavailable" wording already own this case.
    expect(isStaleDay([], at("2026-08-07", "09:00"))).toBe(false);
  });

  it("skips unparseable departures instead of letting one bad row decide", () => {
    const sailings = [{ departs: "not-a-date" }, { departs: day("2026-08-07", "06:20") }];
    expect(isStaleDay(sailings, at("2026-08-07", "09:00"))).toBe(false);
    expect(isStaleDay([{ departs: "not-a-date" }], at("2026-08-07", "09:00"))).toBe(false);
  });

  it("crosses a DST boundary on Pacific days, not UTC ones", () => {
    // 2026-11-01 is the PDT->PST fall back. A sailing at 23:30 Pacific on
    // Oct 31 is already Nov 1 in UTC; reading the day in UTC would call this
    // fresh at 08:00 on Nov 1, when it is a day old in Kingston.
    const sailings = [{ departs: day("2026-10-31", "23:30") }];
    expect(isStaleDay(sailings, at("2026-11-01", "08:00"))).toBe(true);
  });
});

/** Mount the hook and hand back the spy it was given. */
function mountWake() {
  const onWake = vi.fn();
  function Probe() {
    useWakeRefresh(onWake);
    return null;
  }
  const view = render(<Probe />);
  return { onWake, view };
}

/** jsdom leaves document.hidden read-only, so the visibility gate needs this. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}

describe("useWakeRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires on window focus — the wake with the tab never hidden", () => {
    const { onWake } = mountWake();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("fires on `online` — the post-wake wifi rejoin", () => {
    const { onWake } = mountWake();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("fires on a bfcache restore but not on an ordinary pageshow", () => {
    const { onWake } = mountWake();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(onWake).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("collapses two signals arriving together into one refresh", () => {
    // A real wake fires focus and online within the same second. That is one
    // wake, and must cost one request.
    const { onWake } = mountWake();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("fires again once the debounce window has passed", () => {
    const { onWake } = mountWake();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(onWake).toHaveBeenCalledTimes(2);
  });

  it("stays silent while the tab is hidden — that is the callers' poll pause", () => {
    const { onWake } = mountWake();
    setHidden(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    expect(onWake).not.toHaveBeenCalled();
  });

  it("fires on a clock jump — the sleep where no event fires at all", () => {
    const { onWake } = mountWake();
    // Fake timers advance the clock in lockstep with the interval, so an
    // ordinary tick must NOT look like a sleep.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onWake).not.toHaveBeenCalled();

    // Now the real thing: the watchdog's next run lands eight hours later than
    // its last, which is only possible if the machine was not running.
    vi.setSystemTime(new Date(Date.now() + 8 * 60 * 60_000));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("unhooks everything on unmount", () => {
    const { onWake, view } = mountWake();
    view.unmount();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      vi.advanceTimersByTime(60_000);
    });
    expect(onWake).not.toHaveBeenCalled();
  });
});
