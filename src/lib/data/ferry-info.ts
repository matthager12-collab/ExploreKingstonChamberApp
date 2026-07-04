// Ferry payment + vehicle boarding-pass facts for Kingston, WA.
// Verified July 3, 2026 (adversarial verify pass applied). Rendered by
// /ferry. Keep this the single source of truth so the pages never drift.
//
// Key corrections baked in:
//   - The self-serve ticket KIOSKS are card-only. Walking on FROM Kingston is
//     free (fares are collected at Edmonds), so most walk-on visitors pay
//     nothing at the dock.
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

// Mutable field shapes for the admin-editable overlay (ferry-info-store.ts).
// Structurally identical to the `as const` seeds below; kept here so the pure
// data module owns the types and client components (the editor) can import
// them without pulling in the server-only store.
export interface FerryPayment {
  methods: string[];
  kioskNote: string;
  cashNote: string;
  surchargeNote: string;
  freeLegNote: string;
}

export interface BoardingPass {
  summary: string;
  whenRequired: string;
  where: string;
  how: string[];
  voids: string;
  exempt: string;
  currentNote: string;
}

export interface FerryInfo {
  payment: FerryPayment;
  boardingPass: BoardingPass;
  cashTips: string[];
  sources: Source[];
}

export const FERRY_PAYMENT = {
  methods: [
    "Credit or debit card (Visa, Mastercard, Amex, Discover) — subject to a 3% surcharge",
    "ORCA card, tap to pay — avoids the 3% surcharge if it wasn't loaded at a WSF facility",
    "Wave2Go ticket bought online in advance (a card purchase, so the 3% still applies)",
  ] as string[],
  kioskNote:
    "The self-serve ticket kiosks at the Kingston terminal are card-only.",
  cashNote:
    "Cash still works at the staffed tollbooths, but there's no ATM at the dock — the nearest cash machines are up in downtown Kingston. If you're paying cash, have it ready before you reach the booth.",
  surchargeNote:
    "Since March 1, 2026, every credit/debit card ferry fare carries a 3% surcharge (per RCW 47.60.860). The reliable way to skip it is a pre-loaded ORCA card that wasn't loaded at a WSF facility.",
  freeLegNote:
    "Walking on from Kingston is free — WSF collects passenger fares only at Edmonds. So most walk-on day-trippers board at the Kingston dock without paying anything there at all.",
} as const;

// Quick, scannable cash/payment tips for the dock. Kept as a plain list so the
// Chamber can reorder or reword each line without touching prose paragraphs.
export const CASH_TIPS: string[] = [
  "There's no ATM at the ferry dock — get cash up in downtown Kingston first if you need it.",
  "A pre-loaded ORCA card is the cheapest way to pay: tap to board and skip the 3% card surcharge.",
  "Walking on from Kingston is free — passenger fares are collected at Edmonds, not here.",
  "Good To Go! passes are for highway tolls only and will not pay a ferry fare.",
];

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

export const SOURCES: Source[] = [
  {
    label: "WSF — ticket information (3% card surcharge)",
    url: "https://wsdot.wa.gov/travel/washington-state-ferries/tickets/ticket-information",
  },
  {
    label: "WSDOT Blog — Smoother Sailing in Kingston: the new SR 104 boarding-pass system",
    url: "https://wsdotblog.blogspot.com/2026/04/smoother-sailing-in-kingston-new-sr-104.html",
  },
];
