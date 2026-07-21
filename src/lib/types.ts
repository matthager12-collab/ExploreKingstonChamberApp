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
  lat: number;
  lng: number;
  walkMinutesFromFerry: number;
  /** Admin show/hide toggle: when true, dropped from /eat, near-me, and maps. */
  hidden?: boolean;
}

export interface ParkingArea {
  id: string;
  name: string;
  type: "lot" | "street" | "ferry-holding";
  address: string;
  rates: string;
  timeLimit?: string;
  notes?: string;
  lat: number;
  lng: number;
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

export interface Lodging {
  id: string;
  name: string;
  type: "hotel" | "vacation-rental" | "bnb" | "camping" | "marina";
  description: string;
  address?: string;
  website?: string;
  bookingUrl?: string;
  tags: string[];
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
