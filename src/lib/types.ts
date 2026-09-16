// Domain model for Visit Kingston.
// Every feature reads these types; data adapters in src/lib/data map
// external sources (WSDOT API, static seed files, Chamber-entered content)
// into them so sources can be swapped without touching UI code.

export type FerryRoute = "edmonds-kingston" | "kingston-seattle-fast";
export type Direction = "to-kingston" | "from-kingston";

export interface Sailing {
  route: FerryRoute;
  direction: Direction;
  /** ISO 8601 local time, e.g. "2026-07-02T14:30:00-07:00" */
  departs: string;
  arrives?: string;
  vessel?: string;
  notes?: string;
}

export interface TerminalStatus {
  terminal: "kingston" | "edmonds";
  driveUpSpaces?: number;
  waitEstimate?: string;
  alerts: string[];
  /** false when served from the bundled fallback schedule */
  live: boolean;
  asOf: string;
}

export interface Webcam {
  id: string;
  name: string;
  location: string;
  imageUrl: string;
  /** Page to credit/link back to, per source embedding terms */
  sourceUrl: string;
  source: string;
  refreshSeconds: number;
}

/**
 * One day's open/close spans as 24h "HH:mm" pairs, e.g. [["11:00","20:00"]].
 * Empty array = closed. Two pairs = split shift (lunch/dinner). A close time
 * at or before its open time means the span runs past midnight.
 */
export type DayHours = [string, string][];

export interface WeeklyHours {
  mon: DayHours;
  tue: DayHours;
  wed: DayHours;
  thu: DayHours;
  fri: DayHours;
  sat: DayHours;
  sun: DayHours;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  description: string;
  address: string;
  phone?: string;
  website?: string;
  menuUrl?: string;
  orderingUrl?: string;
  orderingPlatform?: "toast" | "square" | "doordash" | "own-site" | "phone-only";
  hours?: string;
  /** Structured hours powering the live "Open now" badge */
  weeklyHours?: WeeklyHours;
  /** ISO date the hours were last verified against live sources */
  hoursVerified?: string;
  priceLevel: 1 | 2 | 3;
  tags: string[];
  /** Photo-library names, in display order; the first is the card image.
   *  Empty or absent means the card renders without a photo (E-media). */
  images?: string[];
  lat: number;
  lng: number;
  walkMinutesFromFerry: number;
  /** Admin show/hide toggle: when true, dropped from /eat, near-me, and maps. */
  hidden?: boolean;
  /** Explicit feature-map icon (Food/Coffee/Drinks). Absent = the classifier
   *  guesses from cuisine/tags (src/lib/map/restaurant-category.ts). */
  mapCategory?: "food" | "coffee" | "drink";
}

export interface Atm {
  id: string;
  name: string;
  operator: string;
  address: string;
  feeNote: string;
  walkMinutesFromFerry: number;
  lat: number;
  lng: number;
  notes?: string;
}

/** Imported / hand-created directory listing (E17) — businesses outside the
 *  curated restaurant/lodging/charity domains. Admin-and-owner-facing only:
 *  no public surface renders this domain yet (E17 non-goal). */
export interface DirectoryListing {
  id: string;
  name: string;
  category: "eat" | "stay" | "shop" | "services" | "activities" | "community" | "other";
  description: string;
  address?: string;
  phone?: string;
  website?: string;
  tags: string[];
  /** Import provenance: raw upstream category strings, verbatim. */
  sourceCategories?: string[];
  /** Optional until placed (geocode pass or admin): the pin position for the
   *  directory map source. Admin-writable only — member edits preserve them,
   *  the same rule as restaurant coordinates. Both present or both absent. */
  lat?: number;
  lng?: number;
  /** Import provenance: vendor image URLs — never rendered publicly. */
  sourceImages?: { logo?: string; listingImage?: string };
}

export interface Lodging {
  id: string;
  name: string;
  type: "hotel" | "vacation-rental" | "bnb" | "camping" | "marina";
  description: string;
  address?: string;
  website?: string;
  bookingUrl?: string;
  tags: string[];
  /** Photo-library names, in display order; the first is the card image.
   *  Empty or absent means the card renders without a photo (E-media). */
  images?: string[];
}

export type EventCategory =
  | "festival"
  | "market"
  | "music"
  | "community"
  | "charity"
  | "sports"
  | "arts";

export interface EventItem {
  id: string;
  title: string;
  /** ISO 8601 */
  start: string;
  end?: string;
  venue: string;
  address?: string;
  description: string;
  category: EventCategory;
  organizer: string;
  url?: string;
  /** Public "who to contact about this event" (name + email/phone), shown on
   *  the event so the public asks the organizer, not the Chamber. Distinct
   *  from a submitter's private contact (which never leaves the worklist).
   *  Optional on the type — ingested/seed events have none; the public
   *  suggest form requires it (enforced at the route). */
  eventContact?: string;
  /** Uploaded artwork/flyer references — Vercel Blob URLs (prod) or
   *  .data/events-relative paths (dev). Rendered on the event once live. */
  attachments?: string[];
  /** set for nonprofit events that appear in the charity portal too */
  charityId?: string;
  /** portal ownership: the listing/org id whose account manages this event */
  ownerId?: string;
  /** RFC 5545 RRULE (no "RRULE:" prefix) when this event repeats — the same
   *  field the ingested feeds carry, so one expander serves both. Built from
   *  the closed preset set in src/lib/events/recurrence.ts; `start` is the
   *  series anchor (DTSTART). Absent = a single occurrence. */
  rrule?: string;
  /** Dates lifted out of the series ("no market that Saturday"), as instants
   *  matching the occurrence they cancel. Only meaningful alongside `rrule`. */
  exdates?: string[];
}

export interface ItineraryStop {
  time: string;
  title: string;
  description: string;
  /** query string for a Google Maps deep link, e.g. an address or place name */
  mapQuery?: string;
}

export interface Itinerary {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  duration: string;
  mode: "walk-on" | "car" | "either";
  audience: string[];
  stops: ItineraryStop[];
}

export interface Charity {
  id: string;
  name: string;
  mission: string;
  website?: string;
  contactEmail?: string;
}

export interface VolunteerNeed {
  id: string;
  charityId: string;
  eventId?: string;
  title: string;
  /** ISO 8601 date of the shift */
  date: string;
  timeRange: string;
  slotsTotal: number;
  slotsFilled: number;
  description: string;
  /** "HH:MM" 24-hour Pacific — the machine-readable start the free-text
   *  timeRange never reliably gave us (E20; powers the T-2h reminder). */
  startTime?: string;
}

export interface HuntStop {
  id: string;
  title: string;
  clue: string;
  hint: string;
  lat: number;
  lng: number;
  /** how close (meters) the GPS check-in must be */
  radiusMeters: number;
  photoPrompt: string;
  funFact: string;
}

export interface Hunt {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "moderate";
  durationMinutes: number;
  stops: HuntStop[];
}

/** One anonymous LTAC visitor-survey response. No PII is collected.
 *  (E11: the dead zip/state fields were removed — the UI never asked for
 *  them; historical rows carrying them are stripped by privacy-backfill.) */
export interface SurveyResponse {
  submittedAt: string;
  distanceBand: "local" | "10-50mi" | "50mi-plus" | "out-of-state" | "international";
  overnight: boolean;
  lodgingNights?: number;
  lodgingType?: string;
  partySize?: number;
  primaryReason?: string;
}

/** Lowest and highest star a feedback submission may carry. Exported because
 *  the widget renders this many stars, the route validates against it, and the
 *  admin page buckets by it — three places that must never disagree. */
export const FEEDBACK_MIN_RATING = 1;
export const FEEDBACK_MAX_RATING = 5;

/** Longest comment the route stores. Anything past this is truncated, not
 *  rejected — a visitor who wrote an essay still gets their point across, and
 *  a rejection would lose the whole submission. */
export const FEEDBACK_COMMENT_MAX = 2_000;

/** Longest name and address stored. 254 is the RFC 5321 limit on an address;
 *  80 is a round number with room to spare for a name. Both bound a hostile
 *  client rather than a real visitor. */
export const FEEDBACK_NAME_MAX = 80;
export const FEEDBACK_EMAIL_MAX = 254;

/** One in-app feedback submission from the site-wide side tab.
 *
 *  THIS STORE HOLDS AN IDENTIFIER. It did not until DEC-002
 *  (docs/FEEDBACK-GUARDRAIL/decisions.md), and the note that used to sit here
 *  forbidding one has been honoured rather than deleted: `feedback_response` is
 *  now a full PiiStore in src/lib/privacy/pii-inventory.ts with real
 *  find/export/delete handlers, keyed on `email`.
 *
 *  Two things that follow, and neither is optional:
 *   - The address is OPTIONAL and UNVERIFIED (DEC-005). Anyone can type anyone
 *     else's. The fulfilment flow is admin-reviewed for exactly that reason, so
 *     never build automated deletion on it.
 *   - Rows carrying no address stay findable only by their own wording, exactly
 *     as every row was before. The store is PARTIALLY searchable, and the
 *     privacy notice says so.
 *
 *  Still the app's highest-PII-risk log — 12-month retention, the shortest in
 *  the schedule, never exported to anyone but an admin. */
export interface FeedbackResponse {
  submittedAt: string;
  /** 1–5. Always present — the widget cannot submit without a rating. */
  rating: number;
  /** The open text answer. Absent when the visitor rated without writing.
   *  When `moderated` is true this is a neutral rewrite, NOT what the visitor
   *  typed — the original is never stored (DEC-003). */
  comment?: string;
  /** In-app path the tab was opened from, e.g. "/ferry" — never a full URL,
   *  query string, or hash. `REDACTED_PATH` when the page is a sensitive
   *  destination (src/lib/privacy/policy.ts). */
  path: string;
  /** Optional, unverified. Offered so the Chamber can reply; never required,
   *  and absent on most rows. */
  name?: string;
  /** Optional, unverified. The key the privacy access/delete path searches by
   *  — see the block above and DEC-005. */
  email?: string;
  /** True when `comment` is a rewrite the guardrail produced because the
   *  visitor's wording was rude. Absent means the comment is verbatim.
   *  Load-bearing: it is the only signal that shows the classifier over-firing
   *  (DEC-003), so the admin table renders it. */
  moderated?: boolean;
}

/** Stand-in stored instead of a real path when feedback comes from a page in
 *  SENSITIVE_PATHS. The submission is kept — a visitor who chose to tell the
 *  Chamber something should be heard — but the page that would reveal they
 *  were seeking food or health assistance is not. */
export const REDACTED_PATH = "(withheld)";
