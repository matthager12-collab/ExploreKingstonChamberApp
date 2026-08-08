"use client";

// The two live ferry boards' shared answer to one question: "is what is on
// screen still about TODAY?"
//
// Both boards (app/(site)/ferry/ferry-board.tsx and components/next-ferries.tsx)
// poll /api/ferry/status on a 60s interval and re-fetch on visibilitychange.
// That covers a visitor who tabs away and back. It does NOT cover the case this
// module exists for, reported 2026-08-07: a laptop left open overnight with the
// board frontmost. The tab was never HIDDEN, so no visibilitychange fires on
// wake; the poll interval did not run while the machine slept; and every
// sailing in the overnight payload is now in the past — which both boards
// render as a confident "Done for today", with no banner, because their empty
// state asks only "are there sailings after now?" and never "is this payload
// even from today?".
//
// Two independent fixes, deliberately kept separate because they fail
// separately: useWakeRefresh() shortens the window, isStaleDay() makes the
// board honest DURING it (and stays honest if the network never comes back).

import { useEffect, useRef } from "react";
import { pacificDay } from "@/lib/time";

/* ------------------------------------------------------------------ */
/* Wake detection                                                      */
/* ------------------------------------------------------------------ */

/** How often the watchdog samples the wall clock. */
const WATCH_MS = 10_000;

/**
 * A gap large enough to mean the watchdog ITSELF did not run — six missed
 * samples, not one. Browsers throttle background timers hard (a 10s interval
 * stretches toward 60s in a hidden tab), and ordinary throttling must not read
 * as a wake. The document.hidden gate in wake() makes that mostly moot; six
 * samples is so that "mostly" is not the only thing holding it up.
 */
const JUMP_MS = 60_000;

/**
 * Two signals arriving together (a wake usually fires `focus` and `online`
 * within the same second) are one wake, not two. Swallow the second rather
 * than spending a duplicate request on it.
 */
const DEBOUNCE_MS = 3_000;

/**
 * Call `onWake` whenever the page plausibly just came back to life.
 *
 * Four signals, because no one of them covers what the others miss:
 *
 *   focus      A wake with the tab already visible, and the alt-tab back from
 *              another WINDOW — a tab merely occluded by another window is
 *              still `visible`, so visibilitychange never fires for it.
 *   online     The wake path's real hazard, not a nicety. A laptop rejoins
 *              wifi a few seconds AFTER it wakes, so the first post-wake fetch
 *              is the one most likely to fail — and a board that takes that
 *              failure prints "saved times as of…" and then waits a full poll
 *              period before trying again.
 *   pageshow   bfcache restore: Safari's back button, iOS app switching. The
 *              document resumes with its timers intact and its data as old as
 *              the moment it was frozen.
 *   clock jump The only one that catches a sleep with the tab visible and
 *              focused throughout, where no event fires at all. A timer that
 *              should have run six times and ran once IS the sleep.
 *
 * Deliberately NOT handled here: visibilitychange. Both callers already own it,
 * and they use it to START AND STOP their poll interval rather than merely to
 * refresh — taking it over would split one decision across two files. The
 * debounce is what keeps this hook from double-firing against theirs.
 */
export function useWakeRefresh(onWake: () => void): void {
  // A ref, not a dep: `onWake` closes over the caller's state and is rebuilt on
  // every render, so a dep array containing it would tear down and re-add these
  // listeners on every poll — the same reasoning as the lastGoodRef in both
  // boards. The listeners must mount exactly once.
  const cbRef = useRef(onWake);
  // Restated in a commit-phase effect rather than assigned during render: a
  // ref write during render is not safe under concurrent rendering (a render
  // React throws away would still have mutated it), and the lint rule that
  // says so is on as an error here.
  useEffect(() => {
    cbRef.current = onWake;
  });

  useEffect(() => {
    let lastSample = Date.now();
    let firedAt = 0;

    function wake() {
      // A hidden tab is one the callers have deliberately stopped polling.
      // Firing here would resurrect exactly the background traffic that pause
      // exists to avoid — and their visibilitychange handler already refreshes
      // the moment it comes back.
      if (document.hidden) return;
      const now = Date.now();
      if (now - firedAt < DEBOUNCE_MS) return;
      firedAt = now;
      cbRef.current();
    }

    const watch = setInterval(() => {
      const now = Date.now();
      const slept = now - lastSample > JUMP_MS;
      lastSample = now;
      if (slept) wake();
    }, WATCH_MS);

    // pageshow fires on EVERY load, not just a restore; only the restore is
    // news, because a fresh load already has fresh data.
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) wake();
    }

    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearInterval(watch);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}

/* ------------------------------------------------------------------ */
/* Day staleness                                                       */
/* ------------------------------------------------------------------ */

/**
 * Is every sailing in this payload from a Kingston day that has already ended?
 *
 * The question both boards' empty states failed to ask. "No sailings after now"
 * has two very different causes — the day's boats have genuinely finished, or
 * we are holding a payload from a previous day — and only the first one
 * licenses "Done for today".
 *
 * Dated from the SAILINGS rather than from a fetch timestamp on purpose: the
 * /ferry page assembles its own initial payload from getTodaysSailings() and
 * never carries the snapshot's `generatedAt`, so a timestamp check would need
 * plumbing through two pages and would then be testing when we ASKED rather
 * than what we GOT.
 *
 * Strictly-before, not not-equal, and that strictness is load-bearing in both
 * directions:
 *
 *   - WSF's "schedule today" runs past midnight (the last Edmonds boat leaves
 *     around 01:25), so a payload fetched at 23:00 legitimately contains
 *     sailings dated TOMORROW. Those must not read as stale.
 *   - At 00:30 that same payload's remaining boat is still the right answer,
 *     and its day is today, so it correctly does not trip this.
 *
 * An EMPTY payload returns false: there is nothing to date it by, and inventing
 * a staleness claim from no evidence is the failure mode this whole module is
 * pushing back on. That case already has honest wording of its own ("live times
 * unavailable" / the schedule-only badge).
 */
export function isStaleDay(
  sailings: readonly { departs: string }[],
  nowMs: number,
): boolean {
  let latest = "";
  for (const sailing of sailings) {
    // A malformed departs would make pacificDay() throw on an Invalid Date.
    // Skip it: one bad row must not decide the honesty of the whole board.
    const t = Date.parse(sailing.departs);
    if (Number.isNaN(t)) continue;
    const day = pacificDay(t);
    if (day > latest) latest = day;
  }
  if (latest === "") return false;
  return latest < pacificDay(nowMs);
}
