// Kingston parking — rewritten from research verified July 2, 2026 against:
//   Port of Kingston live parking page: https://portofkingston.org/port-of-kingston-parking/
//   Port 2025 Parking Policy PDF + official parking map dated 12-30-25
//     (POKPARK / POKHILL / POKTT text-to-pay zones, 25023 short code)
//   WSDOT Kingston terminal page (Diamond lot D515, 73 stalls, $8/$12 + multi-day rates)
//   Diamond PermitPoint: monthly permit $125.70 as of July 2026 (WSDOT's $100 figure is stale)
//   Kitsap Transit park & ride list (George's Corner, Bayside Community Church)
//   Kitsap County Complete Streets Transportation Report (Heffron, May 2016 — the only
//     public per-street source; its curb inventory dates to 2015, so every street entry
//     below is "probable" and labeled "per 2015 county study — obey posted signs")
//   KCC 46.02/46.04 + RCW 46.55.085 (no county overnight ban; 24-hr abandoned-vehicle rule)
//
// IMPORTANT corrections baked in (they override earlier drafts):
//   - Overnight in Port numbered spaces is PROBABLE, not confirmed — the Port never
//     explicitly authorizes it for cars. Publish "call the Port office first: 360-297-3545".
//   - No RV parking on Port property, period (per the Port's live website — stricter
//     than the policy PDF; we publish the conservative version).
//   - The free 2-hour row is ~30 stalls (schematic count), not 40.
//   - The free 2-hour row sits beside Mike Wallace Park's NW corner — an earlier
//     draft placed it ~70 m NE at the Washington Blvd/SR-104 fork by Kiwanis
//     Park (the wrong park). The polygon below is the corrected location.
//   - Pennsylvania Ave is unrestricted on ONE SIDE ONLY; the other side is no-parking.
//   - Diamond D515 is 73 stalls per WSF (Parkopedia says 71).
//
// Port section polygons (July 2, 2026): georeferenced from the Port's official
// 12-30-25 schematic map, then snapped per-zone to Esri World Imagery aerials
// (±5–10 m — the schematic's similarity-fit residuals grow to ~15 m at the map
// edges, hence the per-zone snapping). All Port geometry is "probable" and
// deliberately hand-adjustable — a Chamber admin can drag any shape or pin to
// reality at /admin/map (edits overlay this seed via the "parking-zones" JSON
// store). Not polygonized: disabled stalls, the 3 employee stalls, Port-use
// stalls, and the small tenant caps at the SE ends of fan rows 19–88 and 1–4.
//
// The Port revises rates and Diamond reprices permits — re-verify quarterly.

import type { ParkingArea } from "../types";

/* ------------------------------------------------------------------ */
/* Rich map dataset (used by the town map + parking page)              */
/* ------------------------------------------------------------------ */

export type ParkingRule =
  | "free-2hr"
  | "free-unrestricted"
  | "paid"
  | "park-and-ride-24h"
  | "prohibited"
  | "load-zone"
  | "permit";

export interface MapZone {
  id: string;
  name: string;
  rule: ParkingRule;
  /** One-line gist shown in popups and card headers. */
  summary: string;
  /** Longer prose for cards. */
  details: string;
  confidence: "verified" | "probable" | "unverified";
  sourceUrl?: string;
  /** Caveat surfaced whenever confidence is not "verified". */
  sourceNote?: string;
  overnight: "yes" | "no" | "confirm-first";
  /** [lat, lng] */
  center: [number, number];
  /** Optional outline for lots/rows with known corner coordinates. */
  polygon?: [number, number][];
}

export const RULE_LABELS: Record<ParkingRule, string> = {
  "free-2hr": "Free — 2-hour limit",
  "free-unrestricted": "Free — no time limit",
  paid: "Paid",
  "park-and-ride-24h": "Park & ride — 24 hr max",
  prohibited: "No parking",
  "load-zone": "Loading / dropoff only",
  permit: "Permit holders only",
};

const STUDY_NOTE = "Per 2015 county study — obey posted signs.";
const STUDY_URL =
  "https://portofkingston.org/wp-content/uploads/2022/10/Kingston-Complete-Streets-Transportation-report.pdf";
const PORT_PARKING_URL = "https://portofkingston.org/port-of-kingston-parking/";
const PORT_MAP_URL =
  "https://portofkingston.org/wp-content/uploads/2025/12/Updated-Parking-Map-12-30-25.pdf";
const KITSAP_TRANSIT_PR_URL =
  "https://www.kitsaptransit.com/rider-resources/park-and-ride-lots";

/** Caveat for every polygon georeferenced from the Port's schematic map. */
const PORT_GEO_NOTE =
  "Outline georeferenced from the Port's official 12-30-25 map and aerial imagery (±10 m) — the painted stall markings on the ground always win.";

/** Stronger caveat for the small shapes placed from the schematic alone. */
const PORT_SCHEMATIC_NOTE =
  "Placed from the Port's schematic map only — among the least certain shapes here. Field-check before relying on the outline; signs and stall markings win.";

export const parkingZones: MapZone[] = [
  /* ---------------- Port of Kingston (georeferenced sections) ---------------- */
  // Superseded (July 2, 2026): the original single port-free-2hr polygon sat
  // ~70 m NE of the real row, at the Washington Blvd/SR-104 fork beside
  // Kiwanis Park — the wrong park. The oval below matches the schematic's
  // stadium shape, its position between row 214–233 and Mike Wallace Park,
  // and the ~30-stall count visible on aerial imagery.
  {
    id: "port-free-2hr-row",
    name: "Free 2-hour row (Mike Wallace Park)",
    rule: "free-2hr",
    summary:
      "Free, 2 hours strictly enforced (~30 stalls) — the Port says do NOT use it for ferry travel. $40 overstay ticket.",
    details:
      "The stadium-shaped island of back-to-back stalls between paid row 214–233 and Mike Wallace Park's NW corner, clearly visible on aerial imagery as an oval double row (~50 m long). Overstays are a $40 ticket (doubles after 15 days; tow possible). If a ferry delay traps you, call the Port office (360-297-3545) BEFORE the two hours expire.",
    confidence: "probable",
    sourceUrl: PORT_MAP_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "no",
    center: [47.79654, -122.49752],
    polygon: [
      [47.796517, -122.497863],
      [47.796657, -122.497223],
      [47.796563, -122.497177],
      [47.796423, -122.497817],
    ],
  },
  {
    id: "port-pokpark-north-rows",
    name: "POKPARK north rows (181–233 & 201–213)",
    rule: "paid",
    summary:
      "$12/12 hr car · $6 motorcycle · $3.49/hr short-term — text POKPARK to 25023. Spaces 181–190, 201–213, 214–233.",
    details:
      "L-shaped block of numbered rows between lower Washington Blvd and the free 2-hour island: two parallel rows (181–190 and 214–233) running ENE–WSW plus the 201–213 stub along the drive at the NE corner near the Shed and the big white building. Also contains 3 employee stalls and a disabled stall (not broken out). Pay by text (POKPARK to 25023, T2 Mobile Pay), at the Marina Office 8am–5pm, or by card by phone 360-297-3545. Overnight for cars is never explicitly authorized — call the Port office first. No RVs on Port property.",
    confidence: "probable",
    sourceUrl: PORT_PARKING_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "confirm-first",
    center: [47.796677, -122.497454],
    polygon: [
      [47.796936, -122.497085],
      [47.796756, -122.496941],
      [47.796726, -122.497024],
      [47.796687, -122.497231],
      [47.79668, -122.497286],
      [47.796425, -122.498005],
      [47.796495, -122.498063],
      [47.796593, -122.497768],
      [47.796647, -122.497811],
      [47.796821, -122.49733],
    ],
  },
  {
    id: "port-pokpark-main-fan",
    name: "POKPARK main lot fan (spaces 1–88)",
    rule: "paid",
    summary:
      "$12/12 hr car · $6 motorcycle · $3.49/hr short-term — text POKPARK to 25023. Spaces 1–88 in the angled rows by the marina.",
    details:
      "The fan of angled double rows in the SW half of the marina lot (rows 19–31/32–46/47–66/67–88, 5–10/11–18, 1–4), 2–3 min walk to the ferry. Polygon includes the internal drive aisles between rows (deliberate merge); its SE edge approximates the boundary where marina-tenant permit stalls take over at the row ends. Same payment and overnight rules as all numbered spaces: text POKPARK to 25023, and call the Port office (360-297-3545) before leaving a car overnight. Monthly commuter permit $139.99 (limited; daily use, not storage).",
    confidence: "probable",
    sourceUrl: PORT_PARKING_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "confirm-first",
    center: [47.796658, -122.498459],
    polygon: [
      [47.797102, -122.498579],
      [47.796665, -122.4982],
      [47.796382, -122.498085],
      [47.796307, -122.498163],
      [47.79649, -122.498455],
      [47.79652, -122.498969],
      [47.797142, -122.498764],
    ],
  },
  {
    id: "port-pokpark-89-103",
    name: "POKPARK row 89–103",
    rule: "paid",
    summary:
      "$12/12 hr car · $6 motorcycle · $3.49/hr short-term — text POKPARK to 25023. Single row of 15 stalls along the drive NW of the yacht club.",
    details:
      "Short numbered row (89–103) lining the loop drive northwest of the Kingston Cove Yacht Club, immediately west of the KCYC-permit-only row. Same rates, payment and overnight rules as the rest of POKPARK (call 360-297-3545 before overnight).",
    confidence: "probable",
    sourceUrl: PORT_PARKING_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "confirm-first",
    center: [47.797108, -122.498495],
    polygon: [
      [47.797247, -122.49855],
      [47.797, -122.49835],
      [47.79697, -122.49844],
      [47.797214, -122.498641],
    ],
  },
  {
    id: "port-pokhill",
    name: "POKHILL hill zone (104–162)",
    rule: "paid",
    summary:
      "$12/12 hr car · $6 motorcycle · $15 truck+trailer ($30/24 hr) · $3.49/hr short-term — text POKHILL to 25023. Spaces 104–132 plus truck/trailer overflow 133–162 on the slope.",
    details:
      "The long double-loaded strip west of the boat-launch access road, running from NE West Kingston Rd downhill to the main lot (~120 m). Spaces 104–132 are general parking; 133–162 are truck-and-trailer overflow for busy launch days. A few Port-use stalls sit at the very top end. Same text-to-pay system (POKHILL to 25023) and overnight rule of thumb: call the Port office first (360-297-3545).",
    confidence: "probable",
    sourceUrl: PORT_PARKING_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "confirm-first",
    center: [47.797685, -122.498838],
    polygon: [
      [47.79824, -122.49903],
      [47.79824, -122.49874],
      [47.79713, -122.49864],
      [47.79713, -122.49894],
    ],
  },
  {
    id: "port-poktt",
    name: "POKTT truck & trailer zone (301–318)",
    rule: "paid",
    summary:
      "Trucks with boat trailers ONLY — $15/12 hr or $30/24 hr, text POKTT to 25023. Spaces 301–318 by the boat launch.",
    details:
      "The westernmost band of the main lot fan, next to the launch approach drive — 18 long angled stalls (trailers clearly visible on aerial imagery). Regular cars may not park here. Trailers may not be dropped without the truck attached; unattended boats on trailers need Port approval. Disabled stalls sit at the SW (launch) end of the band. Multi-day: coordinate with the Port office (360-297-3545).",
    confidence: "probable",
    sourceUrl: PORT_PARKING_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "confirm-first",
    center: [47.79682, -122.49901],
    polygon: [
      [47.79712, -122.49897],
      [47.79706, -122.49873],
      [47.79652, -122.49905],
      [47.79658, -122.49929],
    ],
  },
  {
    id: "port-15min-dropoff",
    name: "15-minute dropoff (Mike Wallace Park edge)",
    rule: "load-zone",
    summary:
      "15-minute dropoff/loading only — on the drive along Mike Wallace Park's west edge, east of the free 2-hour row.",
    details:
      "Hatched dropoff stalls on the short drive between the free 2-hour island's east end and Mike Wallace Park's NW boundary, with disabled stalls just SE of them along the park edge (disabled stalls not polygonized). A small feature placed from the schematic only — the least certain placement in this set; field-check recommended.",
    confidence: "probable",
    sourceUrl: PORT_MAP_URL,
    sourceNote: PORT_SCHEMATIC_NOTE,
    overnight: "no",
    center: [47.79646, -122.49716],
    polygon: [
      [47.79653, -122.49719],
      [47.7965, -122.49706],
      [47.79639, -122.49713],
      [47.79642, -122.49726],
    ],
  },
  {
    id: "port-kcyc-permit-row",
    name: "KCYC permit-only row",
    rule: "permit",
    summary:
      "Kingston Cove Yacht Club permit holders only — row along the drive just NW of the clubhouse.",
    details:
      "Marked 'KCYC PERMIT ONLY' on the Port map, between public row 89–103 and the KCYC clubhouse. Not available to visitors; enforcement is the Port's standard $40–50 ticket schedule.",
    confidence: "probable",
    sourceUrl: PORT_MAP_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "confirm-first",
    center: [47.796802, -122.498228],
    polygon: [
      [47.796915, -122.498263],
      [47.796721, -122.498108],
      [47.79669, -122.498193],
      [47.796884, -122.498349],
    ],
  },
  {
    id: "port-tenant-row-park",
    name: "Marina tenant row (by promenade restrooms)",
    rule: "permit",
    summary:
      "Marina tenant permit required — row between the free 2-hour island and the waterfront promenade restrooms.",
    details:
      "Purple 'MARINA TENANT PARKING (PERMIT REQUIRED)' row on the Port map, running WSW from below the dropoff/disabled area toward the promenade restrooms inside the D-shaped loop pod. Visitors may not park here; moorage tenants use their permit.",
    confidence: "probable",
    sourceUrl: PORT_MAP_URL,
    sourceNote: PORT_SCHEMATIC_NOTE,
    overnight: "confirm-first",
    center: [47.796262, -122.497716],
    polygon: [
      [47.796337, -122.497585],
      [47.796295, -122.497551],
      [47.796187, -122.497848],
      [47.796229, -122.497882],
    ],
  },
  {
    id: "port-tenant-fan-block",
    name: "Marina tenant block (fan row ends)",
    rule: "permit",
    summary:
      "Marina tenant permit required — the largest tenant block, at the SE (waterfront) end of fan rows 5–18.",
    details:
      "The biggest of the purple tenant areas in the main fan, at the waterfront end of the 5–10/11–18 row. Smaller tenant caps also exist at the SE ends of rows 19–88 and 1–4 (not polygonized separately — they fall just outside the POKPARK fan polygon's SE cut).",
    confidence: "probable",
    sourceUrl: PORT_MAP_URL,
    sourceNote: PORT_SCHEMATIC_NOTE,
    overnight: "confirm-first",
    center: [47.796326, -122.498538],
    polygon: [
      [47.796474, -122.498527],
      [47.796419, -122.498367],
      [47.79618, -122.498543],
      [47.796231, -122.498714],
    ],
  },
  {
    id: "port-boat-launch-apron",
    name: "Boat launch apron",
    rule: "prohibited",
    summary:
      "Launch ramp maneuvering apron — no parking. Launch restrooms sit at its center; ramp at the SW corner.",
    details:
      "Paved maneuvering area between the hill-zone drive, the POKTT band and the launch ramp (ramp at ~47.7963, -122.4994). Keep clear for backing trailers; parked vehicles here block the ramp. Trucks with trailers belong in POKTT (301–318) or hill overflow (133–162).",
    confidence: "probable",
    sourceUrl: PORT_MAP_URL,
    sourceNote: PORT_GEO_NOTE,
    overnight: "no",
    center: [47.796418, -122.499288],
    polygon: [
      [47.79656, -122.49928],
      [47.79647, -122.49903],
      [47.79636, -122.49917],
      [47.7963, -122.49947],
      [47.7964, -122.49949],
    ],
  },
  /* ---------------- Diamond / WSDOT lot ---------------- */
  {
    id: "diamond-d515",
    name: "Diamond lot D515 (WSDOT commuter lot)",
    rule: "paid",
    summary:
      "$8 for 0–12 hr, $12 for 12–24 hr — overnight OK. 73 stalls at NE 1st St & Ohio Ave, one block from the ferry. Free with a disabled placard.",
    details:
      "The WSDOT-owned, Diamond-operated lot at 26613 Ohio Ave NE — the angled strip on NE 1st St between Ohio and Iowa, a 5-minute walk to the tollbooths. Overnight and multi-day parking allowed (WSF publishes rates from 2 days $24 up to 7 days $38). Monthly permit $125.70 all-in via Diamond PermitPoint, valid 24/7. Pay at the kiosk (card) or with PayByPhone / ParkMobile. Vehicles with a valid disabled placard or plate park free — this lot only. Questions: Diamond Parking, 206-729-0590.",
    confidence: "verified",
    sourceUrl:
      "https://wsdot.com/ferries/vesselwatch/terminaldetail.aspx?terminalid=12",
    overnight: "yes",
    center: [47.798685, -122.496815],
    // NO POLYGON ON PURPOSE. The four corners that used to sit here described a
    // 98 m × 0.21 m sliver — 21 m² of area for a 73-stall lot that needs ~1,900 m².
    // Two of the corners were near-duplicates, so it drew as a hairline streaked
    // across the other zones rather than as a lot. OpenStreetMap has no footprint
    // for D515 either (its nearest mapped lot is a private customers-only lot 58 m
    // away), so there is nothing to replace it with that we could source. A circle
    // at the verified center claims only what we actually know; re-adding a shape
    // is a job for /admin/maps with aerial imagery under it.
  },

  /* ---------------- Park & rides ---------------- */
  {
    id: "georges-corner-pr",
    name: "George's Corner Park & Ride",
    rule: "park-and-ride-24h",
    summary:
      "Free, 225 stalls, max 24 hours. SR 104 × Hansville Rd, ~2.5 mi from the dock; buses 307 & 391 run to the ferry.",
    details:
      "Kitsap Transit lot at 27618 Hansville Rd NE: free, paved, lit, with a shelter, bike racks/lockers and 4 free EV chargers. Kitsap Transit's posted rule: park & rides are intended for day use and parking is limited to no more than 24 hours — so it works for a day trip, but not for multi-day ferry parking. Routes 307 (Kingston/North Viking Fast Ferry Express) and 391 (Kingston/Bainbridge) connect to the dock.",
    confidence: "verified",
    sourceUrl: KITSAP_TRANSIT_PR_URL,
    overnight: "no",
    center: [47.81256, -122.53962],
  },
  {
    id: "bayside-pr",
    name: "Bayside Community Church Park & Ride",
    rule: "park-and-ride-24h",
    summary:
      "Free, 210 stalls, max 24 hours. Barber Cut Off Rd, ~0.8 mi west of downtown; buses 302 & 391.",
    details:
      "Church lot at 25992 Barber Cut Off Rd NE shared as an official Kitsap Transit park & ride — the only church lot in Kingston with a documented ferry-commuter arrangement. Free, paved, lit; same Kitsap Transit rule: day use, no more than 24 hours. Served by Routes 302 and 391.",
    confidence: "verified",
    sourceUrl: KITSAP_TRANSIT_PR_URL,
    sourceNote:
      "Lot rules verified with Kitsap Transit; pin placement should be double-checked against aerial imagery before print use.",
    overnight: "no",
    center: [47.7987, -122.50823],
  },

  /* ---------------- 2-hour streets (2015 county study) ---------------- */
  {
    id: "street-ne-1st",
    name: "NE 1st St (Ohio–Iowa)",
    rule: "free-2hr",
    summary: "Free on-street parking, posted 2-hour limit in the downtown core.",
    details:
      "The county's downtown parking inventory shows a posted 2-hour limit here, meant to keep spaces turning over for shop customers. Posted hours of the limit aren't documented online — read the sign on the pole; it is the legal authority.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.79862, -122.49724],
  },
  {
    id: "street-ohio-ave",
    name: "Ohio Ave NE (NE 1st–NE 2nd)",
    rule: "free-2hr",
    summary: "Free on-street parking, posted 2-hour limit.",
    details:
      "2-hour limit per the county parking inventory. Free; check the posted sign for the hours the limit applies.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.79965, -122.49525],
  },
  {
    id: "street-iowa-ave",
    name: "Iowa Ave NE (SR 104–NE 3rd)",
    rule: "free-2hr",
    summary: "Free on-street parking, posted 2-hour limit.",
    details:
      "2-hour limit per the county parking inventory. Free; check the posted sign for the hours the limit applies.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.7995, -122.4965],
  },
  {
    id: "street-ne-2nd",
    name: "NE 2nd St (Iowa–Washington)",
    rule: "free-2hr",
    summary: "Free on-street parking, posted 2-hour limit.",
    details:
      "2-hour limit per the county parking inventory. Free; check the posted sign for the hours the limit applies.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.79981, -122.49709],
  },
  {
    id: "street-illinois-ave",
    name: "Illinois Ave NE (mixed)",
    rule: "free-2hr",
    summary:
      "2-hour limit on the lower blocks near SR 104; unrestricted on the upper blocks toward NE 3rd/4th.",
    details:
      "The county inventory shows a split: time-restricted (2-hour) close to SR 104, unrestricted free parking farther up the hill. The block-by-block boundary is only as current as the 2015 survey — go by the signs.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.8008, -122.49649],
  },

  /* ---------------- Unrestricted streets ---------------- */
  {
    id: "street-georgia-ave",
    name: "NE Georgia Ave",
    rule: "free-unrestricted",
    summary:
      "Free, no time limit — the closest truly unlimited street parking to the ferry (with Pennsylvania Ave).",
    details:
      "Inventoried as unrestricted — part of ~90 unrestricted on-street spaces downtown that sat only ~30% full even at peak. Overnight is lawful where no sign restricts it, but a vehicle left in the right-of-way more than 24 hours can be tagged as apparently abandoned and impounded (RCW 46.55.085) — park overnight, don't store.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "yes",
    center: [47.801539, -122.499129],
  },
  {
    id: "street-pennsylvania-ave",
    name: "Pennsylvania Ave NE (one side only)",
    rule: "free-unrestricted",
    summary:
      "Free, no time limit — but on ONE SIDE of the street only. The other side is no-parking.",
    details:
      "The county inventory shows unrestricted parking on one side of Pennsylvania Ave only, with the opposite side (and the stretch near Central Ave) marked no-parking. Same overnight rule as Georgia Ave: lawful where unsigned, but 24+ hours risks abandoned-vehicle tagging under RCW 46.55.085.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "yes",
    center: [47.801407, -122.497531],
  },

  /* ---------------- Prohibited streets ---------------- */
  {
    id: "street-central-ave",
    name: "Central Ave NE",
    rule: "prohibited",
    summary: "No parking along essentially the whole street (bike lanes).",
    details:
      "The main outbound route from the Port to SR 104 — marked prohibited for parking in the county inventory, and it carries bike lanes. Don't park here.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.7997, -122.49836],
  },
  {
    id: "street-washington-blvd",
    name: "Washington Blvd NE (north of the SR 104 loop)",
    rule: "prohibited",
    summary: "No parking on the ferry offload stretch north of the SR 104 loop.",
    details:
      "Marked prohibited in the county inventory. SR 104 outside the downtown core and NE West Kingston Rd are also no-parking, and much of the eastbound SR 104 shoulder is striped/signed against ferry-queue parking. NOTE: this entry no longer covers the block between the two SR 104 legs — that block has 2-hour parking on both sides and is listed separately.",
    confidence: "probable",
    sourceUrl: STUDY_URL,
    sourceNote: STUDY_NOTE,
    overnight: "no",
    center: [47.79855, -122.49419],
  },
  {
    // Chamber field correction, July 2026. The 2015 county inventory marked the
    // WHOLE of Washington Blvd NE as no-parking, so the app was telling visitors
    // they could not park on a block where they can — the costliest direction for
    // this error to point. The offload-route entry above now stops short of here.
    //
    // Extent from OpenStreetMap: the ~114 m of Washington Blvd NE bounded by an
    // SR 104 junction at each end — [47.797036, -122.496929] on the west and
    // [47.797548, -122.495625] on the east (OSM ways 292111730 + 117576626).
    // The block is signed one-way for ferry offload AND has parking both sides;
    // the old entry conflated "one-way offload route" with "no parking".
    //
    // Centre pin only, like every other street entry — MapZone has no polyline,
    // so a two-sided curb cannot be drawn. See the geometry note in the header.
    id: "street-washington-blvd-104-loop",
    name: "Washington Blvd NE (between the SR 104 legs)",
    rule: "free-2hr",
    summary:
      "Free 2-hour parking on BOTH sides, on the block between the two SR 104 legs. One-way for ferry offload — but you may park.",
    details:
      "The short block of Washington Blvd NE enclosed by the SR 104 loop, a block up from the dock. Free parking with a posted 2-hour limit on both sides of the street. The street is one-way here because it carries traffic coming off the boat, which is why an earlier version of this map wrongly showed the whole street as no-parking. Obey the posted signs — they are the legal authority.",
    confidence: "probable",
    sourceNote:
      "Chamber field correction July 2026, replacing the 2015 county study — obey posted signs.",
    overnight: "no",
    center: [47.797292, -122.496277],
  },

  /* ---------------- Unverified — field-check before relying on these ---------------- */
  {
    id: "washington-blvd-lot",
    name: "Washington Blvd lot (32 spaces) — unverified",
    rule: "paid",
    summary:
      "UNVERIFIED — the 2016 county study lists a 32-space public pay lot between Main St and NE 1st; its current operator and payment status are unknown.",
    details:
      "The grass/gravel triangle at roughly 11420 NE 1st St, between NE 1st St, Ohio Ave and Washington Blvd. Listed as the smallest public pay lot in the 2016 study, but nothing current confirms who runs it or how (or whether) you pay in 2026. Field-check before counting on it.",
    confidence: "unverified",
    sourceUrl: STUDY_URL,
    sourceNote: "Unverified — needs an on-the-ground check before you rely on it.",
    overnight: "confirm-first",
    center: [47.798077, -122.496023],
  },
  {
    id: "sr104-wedge-lot",
    name: "Small 2-hour lot at SR 104 / NE 1st split — unverified",
    rule: "free-2hr",
    summary:
      "UNVERIFIED — OpenStreetMap tags a small public lot here with a 2-hour max stay; the only source is the map tag.",
    details:
      "A small lot in the wedge west of NE 1st St where it splits from SR 104, behind the buildings near Iowa Ave. OSM says public access with a 2-hour limit, but no official source confirms it. Verify the signage on the ground before treating it as public parking.",
    confidence: "unverified",
    sourceUrl: "https://www.openstreetmap.org/way/118260727",
    sourceNote: "Unverified — needs an on-the-ground check before you rely on it.",
    overnight: "no",
    center: [47.799109, -122.498188],
  },
];

/* ------------------------------------------------------------------ */
/* Legacy flat list (types.ts shape) for existing consumers            */
/* ------------------------------------------------------------------ */

export const parkingAreas: ParkingArea[] = [
  {
    id: "port-of-kingston-lot",
    name: "Port of Kingston lot",
    type: "lot",
    address: "Port of Kingston Marina, Kingston, WA 98346",
    rates:
      "$12 per 12 hours (standard vehicle) · $6 motorcycle · $15 truck + trailer ($30/24 hrs) · $3.49/hr short-term · monthly commuter permit $139.99 (limited supply)",
    timeLimit:
      "Paid by the 12-hour block; overnight for cars — call the Port office first (360-297-3545). No RV parking on Port property.",
    notes:
      "Right next to the marina and a 2–3 minute walk to the ferry. Every numbered space is paid. Pay by phone with T2 Mobile Pay (text the zone code on the lot signs — POKPARK, POKHILL or POKTT — to 25023), with cash or card at the Marina Office (8–5), or by card over the phone: 360-297-3545. Unpaid tickets double after 15 days; three or more can mean a boot or tow.",
    lat: 47.7967,
    lng: -122.498,
  },
  {
    id: "port-free-2hr-zone",
    name: "Free 2-hour zone (Port marina)",
    type: "street",
    address: "Port of Kingston Marina, Kingston, WA 98346",
    rates: "Free",
    timeLimit: "2 hours, strictly enforced (~30 stalls)",
    notes:
      "Great for a quick lunch or a stroll on the pier — but the Port explicitly says not to use it for ferry travel. If a ferry delay traps you, call the Port office before the two hours expire to request an extension. There are also 15-minute loading zones near the marina.",
    // Corrected July 2026: the old pin (47.79678, -122.4967) sat ~70 m NE at the
    // Washington Blvd/SR-104 fork by Kiwanis Park — the wrong park.
    lat: 47.79654,
    lng: -122.49752,
  },
  {
    id: "diamond-d515-lot",
    name: "Diamond Parking lot D515 (WSDOT commuter lot)",
    type: "lot",
    address: "26613 Ohio Ave NE, Kingston, WA 98346",
    rates:
      "$8 for 0–12 hours · $12 for 12–24 hours · multi-day rates from 2 days $24 to 7 days $38 · monthly permit $125.70 via Diamond PermitPoint",
    timeLimit: "Overnight and multi-day parking allowed",
    notes:
      "73 spaces one block from the tollbooths — about a 5-minute walk. Vehicles with a valid disabled placard or plate park free (this lot only). Pay by card at the kiosk, or with the PayByPhone or ParkMobile apps. Questions: Diamond Parking, 206-729-0590.",
    lat: 47.798685,
    lng: -122.496815,
  },
  {
    id: "sr104-ferry-holding",
    name: "SR 104 ferry holding lanes",
    type: "ferry-holding",
    address: "Kingston Ferry Terminal, 11264 NE State Route 104, Kingston, WA 98346",
    rates: "Not parking — this is the line for the boat",
    notes:
      "During peak periods (daily 8 am–8 pm), ferry traffic on SR 104 stops at Barber Cutoff Rd, takes a boarding pass from the dispenser, and waits for green lights before advancing to the tollbooths. Leave the line and your pass is void — you start over. There are no vehicle reservations on the Edmonds–Kingston run; the line is the system.",
    lat: 47.793,
    lng: -122.509,
  },
  {
    id: "georges-corner-park-and-ride",
    name: "George's Corner Park & Ride",
    type: "lot",
    address: "27618 Hansville Rd NE, Kingston, WA 98346",
    rates: "Free",
    timeLimit: "Maximum 24 hours — day-use lot, not multi-day",
    notes:
      "At SR 104 and Hansville Rd, about 2.5 miles from the dock. Free with 225 stalls, lighting, a shelter and 4 free EV chargers. Kitsap Transit Routes 307 and 391 connect to the ferry — good for a day trip, but not for leaving a car several days.",
    lat: 47.81256,
    lng: -122.53962,
  },
  {
    id: "bayside-park-and-ride",
    name: "Bayside Community Church Park & Ride",
    type: "lot",
    address: "25992 Barber Cut Off Rd NE, Kingston, WA 98346",
    rates: "Free",
    timeLimit: "Maximum 24 hours — day-use lot",
    notes:
      "Official Kitsap Transit park & ride in the church lot ~0.8 miles west of downtown: 210 stalls, paved and lit. Served by Routes 302 and 391.",
    lat: 47.7987,
    lng: -122.50823,
  },
];
