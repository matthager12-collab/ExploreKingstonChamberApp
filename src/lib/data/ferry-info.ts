// Ferry payment + vehicle boarding-pass facts for Kingston, WA.
// Verified July 3, 2026 (adversarial verify pass applied). Rendered by
// /parking (#atms) and /ferry. Keep this the single source of truth so the
// two pages never drift.
//
// Key corrections baked in:
//   - The self-serve ticket KIOSKS are card-only. The STAFFED tollbooth DOES
//     take cash (confirmed locally 2026-07-03), and paying cash avoids the 3%
//     card surcharge. Either way, walking on FROM Kingston is free (fares are
//     collected at Edmonds), so most walk-on visitors pay nothing at the dock.
//   - The 3% card surcharge (since March 1, 2026) and ORCA-avoids-surcharge are
//     verified. No compass words for the free leg — it's "from Kingston,"
//     collected "at Edmonds."
//   - Boarding pass: vehicles only, 8 a.m.–8 p.m., in season + weekends/holidays.
//     As of July 1–2, 2026 the automated dispenser was down and officers were
//     handing passes out by hand at Lindvog staging.

export interface Source {
  label: string;
  url: string;
}

export const FERRY_PAYMENT = {
  methods: [
    "Credit or debit card (Visa, Mastercard, Amex, Discover) — subject to a 3% surcharge",
    "ORCA card, tap to pay — avoids the 3% surcharge if it wasn't loaded at a WSF facility",
    "Wave2Go ticket bought online in advance (a card purchase, so the 3% still applies)",
  ] as string[],
  kioskNote:
    "The self-serve ticket kiosks at the Kingston terminal are card-only — they do not take cash.",
  cashNote:
    "The staffed tollbooth takes cash — and paying cash avoids the 3% card surcharge, so it's the cheapest way to buy a fare in person. (Only the self-serve kiosks are card-only.) Cash is also handy in town for tips, the Sunday market, and small shops.",
  surchargeNote:
    "Since March 1, 2026, every credit/debit card ferry fare carries a 3% surcharge (per RCW 47.60.860). The reliable way to skip it is a pre-loaded ORCA card that wasn't loaded at a WSF facility.",
  freeLegNote:
    "Walking on from Kingston is free — WSF collects passenger fares only at Edmonds. So most walk-on day-trippers board at the Kingston dock without paying anything there at all.",
} as const;

export const BOARDING_PASS = {
  summary:
    "A WSDOT/Washington State Ferries queue system for the SR 104 vehicle line at Kingston. Drivers pull a timestamped pass — like a parking-garage ticket — to hold their place, which stops line-cutting and keeps the queue from backing up through downtown.",
  whenRequired:
    "Vehicles only, and only during peak hours 8 a.m.–8 p.m.: daily through the season (Mother's Day through Indigenous Peoples' Day, Oct. 12, 2026), plus every Saturday and Sunday year-round, plus daily during the weeks of Thanksgiving, Christmas, and New Year's. Outside those windows no pass is needed.",
  where:
    "The automated dispenser is on the ferry-bound side of SR 104 just west of Lindvog Road NE, about a mile before the tollbooths. Farther out, an overhead advisory sign with flashing lights at Barber Cutoff Road (~1 mile west) tells you when the system is active — flashing lights mean get in the ferry lane.",
  how: [
    "Watch for the flashing-light advisory sign at Barber Cutoff Rd — if it's flashing, the system is on.",
    "Follow the traffic signal into the designated ferry lane.",
    "Stop at the dispenser near Lindvog Rd and take a pass (or take one from the officer on duty).",
    "Wait in line; when the terminal has space, your signal turns green.",
    "Move up to the tollbooth and pay (card or ORCA).",
  ] as string[],
  voids:
    "If you leave the line after taking a pass, the pass is void — you have to re-enter and pull a new one. Showing up at the tollbooth without a valid pass during system hours sends you back to the end of the line. So don't duck out for coffee once you're in line.",
  exempt:
    "The system manages the vehicle line only, so foot passengers just walk on — walk-ons, cyclists, motorcycles, and medical-priority-pass holders never need a boarding pass.",
  currentNote:
    "Current note (as of early July 2026): the automated dispenser has been down, so a uniformed traffic-control officer is handing passes out by hand at the Lindvog Road staging area instead.",
} as const;

export const CASH_TIPS: string[] = [
  "The staffed tollbooth takes cash; only the self-serve ticket kiosks are card-only. Bring a card, a tap-to-pay phone, an ORCA card, or cash.",
  "There's a 3% surcharge on all credit/debit card ferry fares (since March 1, 2026). Paying cash at the staffed tollbooth avoids it, and so does a pre-loaded ORCA card (loaded somewhere other than a WSF facility).",
  "Walking on from Kingston is free — passenger fares are collected at Edmonds — so day-trippers usually board the return leg without paying anything at the dock.",
  "The only confirmed 24-hour ATM in town is the Bank of America drive-up at Kingston Center, ~0.5 mi (10–12 min) up the hill on NE State Hwy 104 — non-BofA cards pay a fee. The same lot's Grocery Outlet has an in-store ATM (store hours only), and gives fee-free debit cash-back at the register.",
  "For surcharge-free cash, CO-OP-network credit-union members can use the Kitsap Credit Union walk-up ATM inside Safeway at George's Corner — but that's ~2.5 mi west, drive-only, and lobby hours are weekdays only.",
  "Downtown ATMs are independent (~$3 surcharge). Grocery/store cash-back at the register is a fee-free workaround if you're buying something anyway.",
  "Driving on during peak times? You'll need a vehicle boarding pass (8 a.m.–8 p.m., in season plus weekends/holidays). As of early July an officer may be handing passes out by hand because the machine is down.",
  "Cash is still handy in town for tips, the Sunday Kingston Public Market at Mike Wallace Park (May–Oct, right by the walk-off ramp), and small shops — just don't rely on it for the boat.",
];

export const SOURCES: Source[] = [
  {
    label: "WSF — ticket information (3% surcharge; cash excludes self-serve kiosks)",
    url: "https://wsdot.wa.gov/travel/washington-state-ferries/tickets/ticket-information",
  },
  {
    label: "WSDOT Blog — Smoother Sailing in Kingston: the new SR 104 boarding-pass system",
    url: "https://wsdotblog.blogspot.com/2026/04/smoother-sailing-in-kingston-new-sr-104.html",
  },
];
