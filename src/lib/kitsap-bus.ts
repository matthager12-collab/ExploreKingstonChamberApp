// Kitsap Transit BUS routes serving Kingston — static, verified facts only.
//
// WHY NO TIMETABLE HERE, deliberately. src/lib/kitsap.ts hard-codes fast-ferry
// departure times extracted from GTFS feed S1000066, and that feed expires
// 2026-09-12: after it turns over, hard-coded times are silently wrong. Doing
// the same for buses would put a stale departure board on a wall in public,
// where nobody can tell it is stale and a visitor misses a bus because of it.
// A wrong time is worse than no time.
//
// So this screen answers the questions that DON'T rot — which routes exist,
// where they go, where you catch them — and hands the live schedule to the
// visitor's own phone by QR. If a real GTFS ingest job ever lands (it is listed
// as "planned" in docs/DATA_SOURCES.md §3), this file is what it replaces.
//
// Sources, both checked 2026-07-22:
//   - Kitsap Transit routed-bus listing (route numbers and names)
//   - src/lib/data/parking.ts, whose park-and-ride entries already record which
//     routes connect those lots to the dock, verified with Kitsap Transit.

export interface BusRoute {
  /** Route number as Kitsap Transit publishes it. */
  number: string;
  /** Kitsap Transit's own name for the route — not reworded. */
  name: string;
  /** What a visitor actually gets out of it, in plain words. */
  goes: string;
}

export const KINGSTON_BUS_ROUTES: BusRoute[] = [
  {
    number: "307",
    name: "Kingston / North Viking Fast Ferry",
    goes: "Up Highway 104 past the Village Green and on toward Poulsbo, calling at the George's Corner park-and-ride.",
  },
  {
    number: "391",
    name: "Kingston / Bainbridge",
    goes: "South through Suquamish and Poulsbo to the Bainbridge Island ferry — the way to Seattle without going back across to Edmonds.",
  },
  {
    number: "302",
    name: "Kingston / Suquamish Fast Ferry",
    goes: "Connects Kingston with Suquamish and the Bayside park-and-ride.",
  },
];

/** Kitsap Transit's on-demand service for trips the fixed routes do not cover. */
export const KINGSTON_RIDE = {
  name: "Kingston Ride",
  what: "A book-ahead shared ride for trips around Kingston that the numbered routes do not cover. Ring Kitsap Transit to arrange it.",
};

export const KITSAP_TRANSIT = {
  /** Where the buses pull in, in words a visitor can act on immediately. */
  stop: "Buses stop at the Kingston ferry terminal, on the road side of the toll booths — a two-minute walk from the passenger ramp.",
  phone: "(360) 377-2877",
  tollFreePhone: "1-800-501-RIDE",
  /** Live times, timetables and fares — the QR destination. */
  url: "https://www.kitsaptransit.com/service/routed-buses",
  /**
   * Frequency is DELIBERATELY absent. Kitsap Transit does not publish a headway
   * on the routed-bus listing, and a made-up "every 30 minutes" on a public
   * panel is exactly the kind of confident-sounding wrong that costs somebody a
   * connection. The QR and the phone number are the honest answers.
   */
} as const;
