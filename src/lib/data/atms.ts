// ATMs and cash access reachable from the Kingston ferry dock — re-verified July 3, 2026
// (adversarial verify pass applied).
// Sources: Bank of America locator (Kingston Center drive-up ATM — the only KNOWN/confirmed
// 24-hour bank ATM in town), kitsapcu.org/locations/kingston (walk-up ATM limited to Safeway
// store hours; CO-OP network = only confirmed surcharge-free ATM in 98346),
// kitsapbank.com locations (site blocks bots — verified via Apr 2026 archive snapshot;
// mid-merger into Heritage Bank, systems conversion expected Q3 2026), Speedway,
// Gliding Eagle Market and The Point Casino operator pages, OSM/Yelp for the ARCO
// and Chevron stations, branchspot for the Kingston Center grocery in-store ATM.
// The 10978 Kingston Center grocery is Grocery Outlet (confirmed locally 2026-07-03).
//
// Corrections baked in (verify pass):
//   - Bank of America's nearest full financial center is EDMONDS (~5.7 mi via ferry),
//     NOT Poulsbo. The Kingston Center drive-up is a 24-hour ATM only (no lobby),
//     with cardless/tap and deposits — all verified.
//   - Hwy 104 address numbers DECREASE going uphill/away from the water (11264 near
//     the dock → 10978 at Kingston Center). Never say numbers increase going up.
//   - Ferry cash: the self-serve ticket KIOSKS are card-only, but the STAFFED
//     tollbooth DOES take cash (confirmed locally 2026-07-03), and cash avoids the
//     3% card surcharge. Walking on FROM Kingston is free (passenger fares are
//     collected at Edmonds). The 3% card surcharge (since March 1, 2026) and
//     ORCA-avoids-surcharge are verified. See ferry-info.ts.
//   - There is NO Chevron in downtown Kingston; the only Kingston Chevron is at the
//     Hwy 104 / Bond Rd junction ~3.8 mi west. The near-downtown station is the
//     24-hour ARCO / Kingston Mini-Mart (its ATM is unverified — field-check).
//   - The former Columbia Bank / Umpqua branch at 26563 Lindvog Rd NE is permanently
//     CLOSED — do not list it (directories and OSM still show it).
//   - No ATM at the WSF terminal itself.
// Lat/lng from operator locators / OSM POIs.

import type { Atm } from "../types";

/** Extra per-ATM metadata the Atm type doesn't carry (badges, map styling, routes). */
export interface AtmMeta {
  open24h: boolean;
  /** Approximate drive time from the ferry dock, minutes. */
  driveMinutes: number;
  confidence: "verified" | "probable" | "unverified";
  sourceUrl: string;
  /** Short human label for when the machine is reachable, e.g. "24-hour drive-up". */
  access?: string;
  /** Surcharge-free network this ATM belongs to, if any (e.g. "CO-OP"). */
  surchargeFreeNetwork?: string;
  /** Turn-by-turn-ish walking directions from the ferry walk-off (for close ATMs). */
  walkRoute?: string;
  /** Driving directions from the terminal/downtown. */
  driveRoute?: string;
}

export const atms: Atm[] = [
  {
    id: "bofa-kingston-center",
    name: "Bank of America drive-up ATM (Kingston Center)",
    operator: "Bank of America",
    address: "10978 State Hwy 104, Kingston, WA 98346",
    feeNote:
      "Free for Bank of America cardholders; everyone else pays BofA's ~$3 surcharge plus their own bank's fee — the machine shows the amount before you commit. Not in the MoneyPass or Allpoint networks.",
    walkMinutesFromFerry: 11,
    notes:
      "The only confirmed 24-hour bank ATM in town. Drive-up, takes deposits, supports cardless/tap access. In the Kingston Center plaza on SR 104 — a 10–12 minute uphill walk or 2-minute drive from the dock. ATM only; the nearest full Bank of America financial center is across the water in Edmonds (~5.7 mi via ferry).",
    lat: 47.801839,
    lng: -122.50091,
  },
  {
    id: "kingston-food-market-iga",
    name: "Grocery Outlet (Kingston Center) — in-store ATM",
    operator: "Grocery Outlet in-store ATM",
    address: "10978 NE State Hwy 104, Kingston, WA 98346",
    feeNote:
      "Independent in-store ATM — expect a ~$3 surcharge plus your own bank's fee. Not on any surcharge-free network. Fee-free alternative: ask for cash-back at the register when you buy something with a debit card.",
    walkMinutesFromFerry: 11,
    notes:
      "Inside Grocery Outlet, in the same Kingston Center lot as the BofA drive-up ATM — a 10–12 minute uphill walk or 2-minute drive from the dock. Store hours only (not 24-hour), so it closes when the store does. Handy if you're already grabbing groceries; the register cash-back beats the ATM fee.",
    lat: 47.8018,
    lng: -122.5009,
  },
  {
    id: "downtown-independent-atm",
    name: "Downtown independent ATM — unverified",
    operator: "Independent/ISO ATM (operator unconfirmed)",
    address: "~10958 NE State Hwy 104, Kingston, WA 98346",
    feeNote:
      "If it's there, it's an independent retail ATM — expect a ~$3+ surcharge plus your bank's fee. Not surcharge-free.",
    walkMinutesFromFerry: 5,
    notes:
      "Reported in the downtown blocks just up from the dock (~10958 block), a possible closer fallback than the Kingston Center machines. UNVERIFIED — availability is tied to a host business's hours and no source confirms it. Check in person before counting on it.",
    lat: 47.7985,
    lng: -122.4985,
  },
  {
    id: "kitsap-bank-georges-corner",
    name: "Kitsap Bank — Kingston branch + ATM",
    operator: "Kitsap Bank (merging into Heritage Bank)",
    address: "8190 NE State Hwy 104, Kingston, WA 98346",
    feeNote:
      "Free for Kitsap Bank customers; no surcharge-free network advertised, so expect a ~$2.50–3.50 surcharge otherwise.",
    walkMinutesFromFerry: 50,
    notes:
      "Full-service branch at George's Corner (SR 104 × Hansville Rd), next to Safeway — about 2.5 miles from the dock, a 5–7 minute drive. Lobby Mon–Fri 9–5; 360-297-3034. On-site ATM/interactive teller; 24-hour access not confirmed. Heads-up: Kitsap Bank merged into Heritage Bank in early 2026 — signage and hours could change.",
    lat: 47.8101618,
    lng: -122.5408885,
  },
  {
    id: "kitsap-cu-georges-corner",
    name: "Kitsap Credit Union — walk-up ATM at Safeway",
    operator: "Kitsap Credit Union",
    address: "8196 NE State Hwy 104, Kingston, WA 98346",
    feeNote:
      "The only confirmed surcharge-free ATM in town — free for members of any Co-op-network credit union. Non-network cards pay a surcharge.",
    walkMinutesFromFerry: 50,
    notes:
      "At the Safeway at George's Corner, ~2.5 miles from the dock (5–7 minute drive). The walk-up ATM works during Safeway store hours only — not 24 hours. Branch lobby Mon–Fri 10–6, closed weekends; 360-662-2000. Safeway itself also gives debit cash-back at checkout.",
    lat: 47.811334,
    lng: -122.540547,
  },
  {
    id: "speedway-georges-corner",
    name: "Speedway Express — in-store ATM",
    operator: "Speedway Express #7874",
    address: "8184 NE State Hwy 104, Kingston, WA 98346",
    feeNote:
      "Independent retail ATM — expect a ~$2.50–3.50 surcharge; no surcharge-free network confirmed.",
    walkMinutesFromFerry: 50,
    notes:
      "Gas-station ATM at George's Corner, next to Kitsap Bank and Safeway. Inside the store, so no after-hours access — store hours roughly 6am–9pm daily; (360) 297-0516. ATM presence is from directory data — confirm on arrival.",
    lat: 47.810142,
    lng: -122.540308,
  },
  {
    id: "arco-kingston-mini-mart",
    name: "ARCO / Kingston Mini-Mart — ATM unverified",
    operator: "ARCO (Kingston Mini-Mart)",
    address: "10951 NE State Hwy 104, Kingston, WA 98346",
    feeNote:
      "If present, an independent retail ATM — expect a ~$2.50–3.50 surcharge.",
    walkMinutesFromFerry: 11,
    notes:
      "The closest gas station to the ferry (across SR 104 from the Grocery Outlet plaza), open 24 hours; 360-297-1717. ARCO pumps don't take credit, so an in-store ATM is typical — but no source confirms one. UNVERIFIED — check in person before counting on it.",
    lat: 47.801605,
    lng: -122.501726,
  },
  {
    id: "chevron-hwy104-bond",
    name: "Chevron at Hwy 104 / Bond Rd — in-store ATM",
    operator: "Chevron",
    address: "26605 State Hwy 104 NE, Kingston, WA 98346",
    feeNote:
      "Independent retail ATM — expect a ~$2.50–3.50 surcharge.",
    walkMinutesFromFerry: 75,
    notes:
      "The ONLY Chevron in Kingston — at the Hwy 104/Bond Rd junction ~3.8 miles west of the dock (8–9 minute drive), NOT downtown. Last fuel before the Hood Canal Bridge. Hours Mon–Fri 4:30am–11pm, weekends 6am–11pm; ATM listed by directories, not the operator.",
    lat: 47.804427,
    lng: -122.569936,
  },
  {
    id: "gliding-eagle-market",
    name: "Gliding Eagle Market (Shell) — ATM",
    operator: "Port Gamble S'Klallam Tribe",
    address: "8000 NE Little Boston Rd, Kingston, WA 98346",
    feeNote:
      "Independent ATM — expect a ~$2–3.50 surcharge; no surcharge-free network confirmed.",
    walkMinutesFromFerry: 110,
    notes:
      "ATM confirmed on the market's own site. Inside the store — open daily 6am–10pm, no after-hours access; (360) 655-5541. About 12–13 minutes' drive from the dock via Hansville Rd, at Little Boston.",
    lat: 47.839109,
    lng: -122.541797,
  },
  {
    id: "point-casino",
    name: "The Point Casino & Hotel — ATMs",
    operator: "Port Gamble S'Klallam Tribe",
    address: "7989 NE Salish Ln, Kingston, WA 98346",
    feeNote:
      "Casino ATMs typically surcharge $4–6 — the priciest cash in the area. Fees not published.",
    walkMinutesFromFerry: 110,
    notes:
      "Open 24 hours, but the ATMs sit on the gaming floor (21+). About 11–13 minutes' drive from the dock, off Hansville Rd NE; (360) 297-0070. Useful in a pinch late at night — otherwise use the BofA drive-up.",
    lat: 47.84414,
    lng: -122.541651,
  },
];

export const atmMeta: Record<string, AtmMeta> = {
  "bofa-kingston-center": {
    open24h: true,
    driveMinutes: 2,
    confidence: "verified",
    sourceUrl: "https://locators.bankofamerica.com/wa/kingston/atm-kingston-110084.html",
    access: "24-hour drive-up",
    surchargeFreeNetwork: "none (fee-free for Bank of America customers only)",
    walkRoute:
      "From the ferry walk-off, head up the hill along NE State Hwy 104 (away from the water). The address numbers count DOWN as you climb (11264 near the dock → 10978 at Kingston Center). It's about 0.5 mi / 6 blocks up, on the north side of the highway in the Kingston Center plaza. Sidewalk the whole way, ~10–12 min uphill.",
    driveRoute:
      "From the terminal/downtown, drive up NE State Hwy 104 about 0.5 mi (away from the water). Kingston Center is on the north side; turn into the plaza lot and use the drive-thru ATM lane. ~2 min.",
  },
  "kingston-food-market-iga": {
    open24h: false,
    driveMinutes: 2,
    confidence: "probable",
    sourceUrl: "https://www.branchspot.com/atms/food-market-kingston/",
    access: "store hours only",
    surchargeFreeNetwork: "none",
    walkRoute:
      "Same route as the BofA drive-up: up NE State Hwy 104 about 0.5 mi from the ferry walk-off to the Kingston Center plaza (numbers count down as you climb — 11264 near the dock → 10978). The ATM is inside Grocery Outlet. ~10–12 min uphill.",
    driveRoute:
      "Up NE State Hwy 104 ~0.5 mi to the Kingston Center plaza lot on the north side; park and use the ATM inside the store. Same lot as the BofA drive-up. ~2 min.",
  },
  "downtown-independent-atm": {
    open24h: false,
    driveMinutes: 2,
    confidence: "unverified",
    sourceUrl: "https://www.branchspot.com/atms/food-market-kingston/",
    access: "host-business hours (unconfirmed)",
    surchargeFreeNetwork: "none",
    walkRoute:
      "From the ferry walk-off, head up NE State Hwy 104 into the downtown blocks — reported near the 10958 address, ~2–3 blocks / 0.2 mi up (~4–6 min). Verify on-site before relying on it.",
    driveRoute:
      "In the downtown core along NE State Hwy 104 just up from the terminal; parking is limited, so most drivers find the Kingston Center machines easier to pull into.",
  },
  "kitsap-bank-georges-corner": {
    open24h: false,
    driveMinutes: 6,
    confidence: "verified",
    sourceUrl: "https://www.kitsapbank.com/about-us/locations/",
    access: "lobby Mon–Fri 9–5; on-site ATM (24-hour access unconfirmed)",
    surchargeFreeNetwork: "none (fee-free for Kitsap Bank customers only)",
    driveRoute:
      "Drive west on NE State Hwy 104 about 2.5 mi to George's Corner (SR 104 × Hansville Rd), next to Safeway. The branch and its ATM are right at the corner cluster. ~5–7 min.",
  },
  "kitsap-cu-georges-corner": {
    open24h: false,
    driveMinutes: 6,
    confidence: "verified",
    sourceUrl: "https://kitsapcu.org/locations/kingston/",
    access: "walk-up ATM in Safeway (store hours); lobby Mon–Fri 10–6, closed weekends",
    surchargeFreeNetwork: "CO-OP (surcharge-free for CO-OP-network credit-union members; confirm)",
    driveRoute:
      "Drive west on NE State Hwy 104 about 2.5 mi to George's Corner; the walk-up ATM is inside the Safeway. ~5–7 min. Safeway also gives debit cash-back at checkout.",
  },
  "speedway-georges-corner": {
    open24h: false,
    driveMinutes: 6,
    confidence: "probable",
    sourceUrl: "https://www.speedway.com/locations/store/7874",
    access: "store hours only (~6am–9pm)",
    surchargeFreeNetwork: "none",
    driveRoute:
      "West on NE State Hwy 104 ~2.5 mi to George's Corner, next to Kitsap Bank and Safeway. In-store ATM, so no after-hours access. ~5–7 min.",
  },
  "arco-kingston-mini-mart": {
    open24h: false,
    driveMinutes: 2,
    confidence: "unverified",
    sourceUrl: "https://www.yelp.com/biz/arco-kingston",
    access: "station open 24 hours; ATM presence unconfirmed",
    surchargeFreeNetwork: "none",
    driveRoute:
      "The closest gas station to the ferry, across SR 104 from the Kingston Center plaza — up the hill ~0.5 mi. Open 24 hours, but no source confirms an in-store ATM. ~2 min.",
  },
  "chevron-hwy104-bond": {
    open24h: false,
    driveMinutes: 9,
    confidence: "probable",
    sourceUrl: "https://www.iexitapp.com/business/Chevron/252740",
    access: "station hours (Mon–Fri 4:30am–11pm, weekends 6am–11pm)",
    surchargeFreeNetwork: "none",
    driveRoute:
      "West on SR 104 past George's Corner to the Hwy 104 / Bond Rd junction, ~3.8 mi from the dock — the last fuel before the Hood Canal Bridge. Useful only if you're already driving west. ~8–9 min.",
  },
  "gliding-eagle-market": {
    open24h: false,
    driveMinutes: 13,
    confidence: "verified",
    sourceUrl: "https://glidingeaglemarket.com/amenities/",
    access: "store hours (daily 6am–10pm)",
    surchargeFreeNetwork: "none",
    driveRoute:
      "About 12–13 min from the dock via Hansville Rd, at Little Boston. In-store ATM (confirmed on the market's site), so no after-hours access.",
  },
  "point-casino": {
    open24h: true,
    driveMinutes: 12,
    confidence: "probable",
    sourceUrl: "https://www.thepointcasinoandhotel.com/",
    access: "24 hours (ATMs on the 21+ gaming floor)",
    surchargeFreeNetwork: "none",
    driveRoute:
      "About 11–13 min from the dock off Hansville Rd NE. Open 24 hours, but the ATMs sit on the gaming floor (21+) and carry the priciest fees around — a late-night pinch option only.",
  },
};
