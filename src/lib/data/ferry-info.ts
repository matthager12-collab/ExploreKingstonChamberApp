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
//     `currentNote` ships empty on purpose — it's the Chamber-editable slot for a
//     transient notice (e.g. a dispenser outage), not a place to seed one.

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

/** One labeled fare line. `amount` is free text ("$11.35", "Free") rather than
 *  a number so the Chamber can write "Free" or "$27.00 + $11.35/passenger"
 *  without the display having to guess a currency format. */
export interface FareRow {
  /**
   * Stable identity for the few rows another page quotes INSIDE A SENTENCE
   * rather than rendering as a table line. Not shown to a visitor and not
   * editable at /admin/ferry-info — `label` is what the Chamber owns, and a
   * label is exactly the thing an operator is entitled to reword.
   *
   * Only rows in FARE_ROW_KEYS carry one; everything else is an ordinary,
   * anonymous row. The API drops any other value, so the overlay can never
   * accumulate keys nothing looks for.
   */
  key?: FareRowKey;
  label: string;
  amount: string;
  note?: string;
}

/**
 * The walk-on round-trip fare is quoted in prose on /ferry and, in both
 * languages, in the E14 safety dictionary that feeds /simple and /es. Those
 * sentences need to find this row after an operator has renamed it ("Round
 * trip on foot" → "Walking on, both ways") or dragged it down the list — a
 * label match or an index would silently start quoting the wrong fare, and
 * the readers of /simple and /es are the least likely to catch it.
 */
export const WALK_ON_ROUND_TRIP_KEY = "walk-on-round-trip";

/** Every stable row key. The admin API accepts these and nothing else. */
export const FARE_ROW_KEYS = [WALK_ON_ROUND_TRIP_KEY] as const;
export type FareRowKey = (typeof FARE_ROW_KEYS)[number];

/**
 * A single money figure and nothing else — "$11.35", "$27", "$1,240.00".
 *
 * Deliberately strict. `amount` is free text, so a legitimate Chamber edit can
 * be "Free", "$27.00 + $11.35/passenger", or "see the WSF page" — all fine in
 * the /ferry fare TABLE, all nonsense dropped into "a round trip on foot costs
 * ___, and you pay it once." Anything that is not one plain figure falls back
 * to wording that names no number instead.
 */
const SINGLE_MONEY_FIGURE = /^\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?$/;

/**
 * The walk-on round-trip figure, if the record still holds one that can be
 * dropped into a sentence — otherwise null, and the caller says something true
 * without a number.
 *
 * Never falls back to the seed below: the whole point of E27 making fares
 * editable is that a figure the Chamber has not confirmed must not be
 * published, and quietly reverting to a compiled-in number is precisely the
 * stale-fare bug this replaced.
 */
export function walkOnRoundTripFare(fares: FerryFares): string | null {
  const amount = fares.walkOn.find((r) => r.key === WALK_ON_ROUND_TRIP_KEY)?.amount.trim();
  return amount && SINGLE_MONEY_FIGURE.test(amount) ? amount : null;
}

/**
 * E27 (M-01-06 remainder) — ferry fares as STRUCTURE, not prose.
 *
 * Two reasons this stopped being hardcoded JSX on /ferry:
 *   1. WSF adjusts fares most Octobers. A Chamber staffer has to be able to fix
 *      a figure without a deploy, or the site is wrong every autumn.
 *   2. The senior/disability discount was buried mid-sentence. It is one of the
 *      highest-value facts on the page for the riders it applies to, so it is
 *      now its own labeled row.
 *
 * Static content by design: WSF publishes no per-route fares API worth
 * depending on, so the honest shape is sourced, editable content that links out
 * to the authoritative page. The app never sells a ticket.
 */
export interface FerryFares {
  /** Edmonds–Kingston passenger fares (WSF). */
  walkOn: FareRow[];
  /** Edmonds–Kingston vehicle fares (WSF). */
  drive: FareRow[];
  /** Kitsap Transit passenger-only fast ferry to Seattle. */
  fastFerry: FareRow[];
  /** Freshness label — WSF's October adjustment is the recurring chore. */
  ratesAsOf: string;
  sources: Source[];
}

export interface FerryInfo {
  payment: FerryPayment;
  boardingPass: BoardingPass;
  cashTips: string[];
  sources: Source[];
  fares: FerryFares;
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
    "Vehicles only, and only during peak hours 8 a.m.–8 p.m.: daily in season (roughly Mother's Day through mid-October), plus every Saturday and Sunday year-round, plus daily during the weeks of Thanksgiving, Christmas, and New Year's. Outside those windows no pass is needed.",
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
  // Transient operational notice — ships EMPTY on purpose. Both render sites
  // guard on `.trim()`, so an empty string hides the banner entirely; the
  // Chamber adds a note in /admin/ferry-info when something is actually wrong
  // and clears it afterwards. Never seed a default here: a "right now" fact
  // baked into the defaults is guaranteed to be wrong eventually.
  currentNote: "",
} as const;

/**
 * Seeded with the EXACT figures /ferry rendered as prose before E27 — this is a
 * move, not a re-pricing. Any actual fare correction is a Chamber decision made
 * at /admin/ferry-info, not a code edit.
 */
export const FERRY_FARES = {
  walkOn: [
    {
      // The one figure /ferry, /simple and /es quote in a sentence — see
      // WALK_ON_ROUND_TRIP_KEY. Rename the label freely; keep the key.
      key: WALK_ON_ROUND_TRIP_KEY,
      label: "Round trip on foot",
      amount: "$11.35",
      note: "Boarding in Kingston is always free — Washington State Ferries collects passenger fares only on the Edmonds side, whichever direction you start.",
    },
    {
      label: "Senior or rider with a disability",
      amount: "$5.65",
      // Named explicitly because the discount is worthless if you don't know
      // to ask for it. Eligibility is deliberately NOT asserted here — the WSF
      // fare page below is the authority on what qualifies.
      note: "Reduced fares run through the Regional Reduced Fare Permit (RRFP). Check the WSF fare page for what qualifies.",
    },
    { label: "Kids 18 and under", amount: "Free" },
    {
      label: "Bicycles",
      amount: "Free leaving Kingston",
      note: "Bikes roll on with walk-ons; you pay at Edmonds coming back.",
    },
  ] as FareRow[],
  drive: [
    {
      label: "Car and driver, each way",
      amount: "$27.00",
      note: "Standard vehicle under 22 ft, paid in both directions.",
    },
    { label: "Motorcycle", amount: "$11.80" },
    {
      label: "Each extra passenger",
      amount: "$11.35",
      note: "Collected at Edmonds only.",
    },
  ] as FareRow[],
  fastFerry: [
    { label: "Kingston to Seattle", amount: "$2.00" },
    { label: "Seattle back to Kingston", amount: "$13.00", note: "About $15 round trip." },
    { label: "Youth 18 and under", amount: "Free" },
  ] as FareRow[],
  ratesAsOf:
    "Summer 2026 rates, checked July 2026 — WSF usually adjusts fares each October.",
  sources: [
    {
      label: "WSDOT — Edmonds–Kingston fare details",
      url: "https://www.wsdot.wa.gov/ferries/fares/faresdetail.aspx?departingterm=8&arrivingterm=12",
    },
    {
      label: "Kitsap Transit — Kingston fast ferry",
      url: "https://www.kitsaptransit.com/service/fast-ferry/kingston-fast-ferry",
    },
  ] as Source[],
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
