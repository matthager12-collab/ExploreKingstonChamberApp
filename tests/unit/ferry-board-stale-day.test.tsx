// @vitest-environment jsdom

// The reported bug, at the level a visitor experiences it (2026-08-07): a tab
// left open overnight showed a confident "Done for today — first boat tomorrow
// morning" over a payload from the previous day, with no warning of any kind.
//
// tests/unit/ferry-refresh.test.tsx pins the DECISION (isStaleDay) against
// fixed Pacific instants. This file pins the two boards' WIRING of it — that
// the flag reaches every empty column and that the banner actually renders —
// because the decision being right is worth nothing if a column keeps its old
// wording.
//
// Both boards are driven with a payload dated two days back, which is a prior
// Kingston day whatever hour the suite happens to run at.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FerryBoard, type FerryStatusPayload } from "@/app/(site)/ferry/ferry-board";
import { NextFerries, type FerryStatus } from "@/components/next-ferries";
import type { TerminalStatus } from "@/lib/types";

const DAY_MS = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Sailings on a given day, both directions, all in that day's past. */
function sailingsOn(baseMs: number) {
  return [
    { route: "edmonds-kingston" as const, direction: "from-kingston" as const, departs: iso(baseMs), vessel: "Puyallup" },
    { route: "edmonds-kingston" as const, direction: "to-kingston" as const, departs: iso(baseMs + 40 * 60_000), vessel: "Suquamish" },
  ];
}

const terminal = (t: TerminalStatus["terminal"]): TerminalStatus => ({
  terminal: t,
  alerts: [],
  live: false,
  asOf: iso(Date.now()),
});

function boardPayload(baseMs: number): FerryStatusPayload {
  return {
    carFerry: { sailings: sailingsOn(baseMs), live: true },
    fastFerry: { sailings: [], live: false },
    terminals: { kingston: terminal("kingston"), edmonds: terminal("edmonds") },
    alerts: [],
  };
}

function widgetPayload(baseMs: number): FerryStatus {
  return {
    carFerry: { sailings: sailingsOn(baseMs), live: true },
    alerts: [],
    delays: { toKingston: null, fromKingston: null },
    sailingSpace: { kingston: [], edmonds: [] },
    boardingPass: { active: false, reason: "" },
  };
}

beforeEach(() => {
  // Neither board fetches on mount, but both arm a 60s poll — stub it so a slow
  // machine can never reach a real network call from a unit test.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in unit tests")));
});

afterEach(() => {
  // vitest.config.ts does not set `globals`, so testing-library's auto-cleanup
  // never registers — the house convention is to call it by hand (feedback-tab,
  // side-switcher, claim-listing-focus all do). Without it the second render in
  // a describe finds the first one's DOM still mounted.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FerryBoard — day rollover", () => {
  it("replaces every 'Done for today' with an out-of-date note and warns once", () => {
    render(<FerryBoard initial={boardPayload(Date.now() - 2 * DAY_MS)} serverNow={iso(Date.now())} />);

    // THE BUG: this sentence is the false claim the report was about.
    expect(screen.queryByText(/Done for today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/first boat tomorrow morning/i)).not.toBeInTheDocument();

    // Two car-ferry columns + two "all remaining" lists per ferry = 6 places
    // the old wording could hide. All of them must have switched.
    expect(screen.getAllByText("Times out of date.").length).toBeGreaterThanOrEqual(4);

    // ...and exactly one explanation, not one per column.
    const banners = screen.getAllByText(/These times are from an earlier day/i);
    expect(banners).toHaveLength(1);
    expect(banners[0].closest("p")).toHaveTextContent(/reload the page/i);
  });

  it("leaves today's wording alone when the payload is current", () => {
    // A sailing 40 minutes out: same Kingston day as now, and still upcoming,
    // so the columns render times rather than any empty state.
    render(<FerryBoard initial={boardPayload(Date.now() + 40 * 60_000)} serverNow={iso(Date.now())} />);

    expect(screen.queryByText(/These times are from an earlier day/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Times out of date.")).not.toBeInTheDocument();
  });
});

describe("NextFerries — day rollover", () => {
  it("swaps the column wording and shows the banner", () => {
    render(
      <NextFerries initial={widgetPayload(Date.now() - 2 * DAY_MS)} serverNow={iso(Date.now())} />,
    );

    expect(screen.queryByText("Done for today")).not.toBeInTheDocument();
    expect(screen.getAllByText("Times out of date")).toHaveLength(2); // one per direction

    const banner = screen.getByText(/These times are from an earlier day/i).closest("p");
    expect(banner).toHaveTextContent(/reload the page/i);
    // The honesty link both banners carry, so a reader with a dead tab has
    // somewhere real to go.
    expect(within(banner as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "https://wsdot.wa.gov/travel/washington-state-ferries",
    );
  });

  it("stays quiet when the payload is current", () => {
    render(
      <NextFerries initial={widgetPayload(Date.now() + 40 * 60_000)} serverNow={iso(Date.now())} />,
    );
    expect(screen.queryByText(/These times are from an earlier day/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Times out of date")).not.toBeInTheDocument();
  });
});
