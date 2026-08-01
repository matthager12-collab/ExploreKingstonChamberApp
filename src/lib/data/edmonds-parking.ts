// Edmonds-side parking — the walk-on story ("park in Edmonds, walk on, skip
// the car line"). Facts verified 2026-07-31 against live sources (the banked
// research: EDMONDS-PARKING-RESEARCH-2026-07-31); URLs below re-verified the
// same week. Every entry carries its published source, the same honesty
// contract as MapZone.sourceUrl in ./parking.ts.
//
// DELIBERATELY NOT MapZone, AND NEVER FED TO A MAP. The self-hosted PMTiles
// basemap is a downtown-Kingston bounding box; Edmonds is outside it (widening
// the bbox is an ADR-0006 parameter decision, not this module's). So these
// records carry NO geometry — no center, no polygon, no street paths — and
// must never be imported by map layers, map views, or the admin zone editor.
// tests/unit/edmonds-parking.test.tsx enforces both halves of that.
//
// Visitor-facing SENTENCES live in the copy registry (the edmonds.* block in
// src/lib/site-copy-registry.ts) so the Chamber can edit them without a
// deploy. This module holds only the structure a sentence hangs off: names,
// source links, and Google-Maps directions destinations (no in-app map, so
// each option deep-links out via mapDirectionsUrl instead).
//
// Provenance notes (per-fact confidence, from the banked research):
//   - U-Park: existence/operator/location HIGH (WSDOT's live terminal page);
//     exact rate tiers MEDIUM (WSDOT says $15–$20; older sources disagree —
//     the copy hedges to WSDOT's range and says "verify on site"). Multi-day
//     is UNVERIFIED anywhere, hence the "call first" copy and the honest-gap
//     callout. Phone (206) 284-9797 is published on the WSDOT page.
//   - Street rules: ECC 8.64.060 Schedule VI (HIGH) — 3-hr signed streets,
//     midnight–6 pm except Sundays and holidays; Brackett's Landing 4 hr.
//   - Prohibitions: Salish Crossing lease expiry + towing and Harbor Square
//     patrons-only are My Edmonds News reporting (2026-03); Port marina lots
//     are portofedmonds.gov (HIGH); the Sounder lot's transit-only/24-hr/
//     impound rule is Sound Transit's own parking page (HIGH); "no public
//     parking at the terminal" is WSDOT's terminal page (HIGH).
//   - Bus-in: Community Transit's ferry-connections guide (HIGH) — routes
//     102/130/166/909 to the terminal, and CT's own "parking is limited,
//     take the bus" guidance. The P&R street address is only MEDIUM
//     confidence, so the directions destination is the facility NAME, which
//     Google resolves, rather than a possibly-wrong house number.
//
// Time-sensitive watch items (U-Park rate drift, Sound Transit's possible
// 2027 paid parking, the Sounder lot refilling) live in docs/OPERATIONS.md
// §14.5 — NOT in visitor copy.

const WSDOT_EDMONDS_TERMINAL_URL =
  "https://www.wsdot.com/ferries/vesselwatch/terminaldetail.aspx?terminalid=8";
const ECC_STREET_PARKING_URL = "https://edmonds.municipal.codes/ECC/8.64.060";
const PORT_OF_EDMONDS_PARKING_URL = "https://portofedmonds.gov/marina/parking/";
const SOUND_TRANSIT_PARKING_URL = "https://www.soundtransit.org/ride-with-us/parking";
const CT_FERRY_CONNECTIONS_URL =
  "https://www.communitytransit.org/destination-guides/ferry-connections";
const MY_EDMONDS_NEWS_PARKING_URL =
  "https://myedmondsnews.com/2026/03/asked-and-answered-where-can-i-find-overflow-parking-at-edmonds-sounder-train-station/";

/** The ways a car can legitimately wait on the Edmonds side. */
export type EdmondsOptionId = "upark" | "short-term" | "bus";

export interface EdmondsParkingOption {
  id: EdmondsOptionId;
  /** Card heading (a name, not a sentence — sentences are copy-registry keys). */
  name: string;
  /**
   * Google-Maps directions destination (via mapDirectionsUrl in
   * components/ui). A place name or intersection Google resolves — never a
   * coordinate, and never an address a source only gave MEDIUM confidence.
   */
  directionsDestination: string;
  /** You drive TO all of these — the walking happens at the terminal. */
  directionsMode: "walking" | "driving";
  /** The published source backing the card. */
  sourceUrl: string;
  /** Visible label on the source link. */
  sourceLabel: string;
}

export const edmondsParkingOptions: EdmondsParkingOption[] = [
  {
    id: "upark",
    name: "U-Park lot — Sunset Ave S & James St",
    directionsDestination: "U-Park, Sunset Ave S & James St, Edmonds, WA 98020",
    directionsMode: "driving",
    sourceUrl: WSDOT_EDMONDS_TERMINAL_URL,
    sourceLabel: "WSDOT's Edmonds terminal page",
  },
  {
    id: "short-term",
    name: "Signed streets & Brackett's Landing",
    directionsDestination: "Brackett's Landing South, Edmonds, WA",
    directionsMode: "driving",
    sourceUrl: ECC_STREET_PARKING_URL,
    sourceLabel: "Edmonds city code, ECC 8.64.060",
  },
  {
    id: "bus",
    name: "Community Transit Edmonds Park & Ride",
    directionsDestination: "Edmonds Park & Ride, Edmonds, WA",
    directionsMode: "driving",
    sourceUrl: CT_FERRY_CONNECTIONS_URL,
    sourceLabel: "Community Transit's ferry-connections guide",
  },
];

/** Look up one option by id; throws on a typo so a broken card fails loudly. */
export function edmondsOption(id: EdmondsOptionId): EdmondsParkingOption {
  const found = edmondsParkingOptions.find((o) => o.id === id);
  if (!found) throw new Error(`unknown Edmonds parking option: ${id}`);
  return found;
}

/**
 * Places a ferry rider must NOT leave a car. Prohibitions are first-class
 * content here — each one is a towing or impound a visitor avoids — so each
 * carries its source exactly like the options do.
 */
export type EdmondsNoParkId =
  | "salish-crossing"
  | "harbor-square"
  | "port-lots"
  | "sounder-lot"
  | "terminal";

export interface EdmondsNoParkPlace {
  id: EdmondsNoParkId;
  name: string;
  sourceUrl: string;
  sourceLabel: string;
}

export const edmondsNoPark: EdmondsNoParkPlace[] = [
  {
    id: "salish-crossing",
    name: "Salish Crossing (170–190 Sunset Ave)",
    sourceUrl: MY_EDMONDS_NEWS_PARKING_URL,
    sourceLabel: "My Edmonds News, March 2026",
  },
  {
    id: "harbor-square",
    name: "Harbor Square (south of Dayton St)",
    sourceUrl: MY_EDMONDS_NEWS_PARKING_URL,
    sourceLabel: "My Edmonds News, March 2026",
  },
  {
    id: "port-lots",
    name: "Port of Edmonds marina lots",
    sourceUrl: PORT_OF_EDMONDS_PARKING_URL,
    sourceLabel: "Port of Edmonds parking rules",
  },
  {
    id: "sounder-lot",
    name: "Edmonds Station lot (211 Railroad Ave)",
    sourceUrl: SOUND_TRANSIT_PARKING_URL,
    sourceLabel: "Sound Transit's parking rules",
  },
  {
    id: "terminal",
    name: "The ferry terminal itself",
    sourceUrl: WSDOT_EDMONDS_TERMINAL_URL,
    sourceLabel: "WSDOT's Edmonds terminal page",
  },
];

/** Look up one no-park place by id; throws on a typo. */
export function edmondsNoParkPlace(id: EdmondsNoParkId): EdmondsNoParkPlace {
  const found = edmondsNoPark.find((p) => p.id === id);
  if (!found) throw new Error(`unknown Edmonds no-park place: ${id}`);
  return found;
}
