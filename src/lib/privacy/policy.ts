// E11 privacy policy manifest — the single source of truth the privacy
// package hangs off. Everything here is deliberately dependency-free and
// client-safe: the client tracker imports the sensitive-destination helpers
// (defense in depth), the retention purge job executes RETENTION_POLICY, and
// the public /privacy page renders it — one manifest, so the published
// promise and the enforcing code can never drift apart.
//
// Ask-first floor (E11 plan §4-a, confirmed by Mat 2026-07-20): the retention
// windows and K_FLOOR below are the Chamber's published numbers. Changing any
// of them is a human decision that shows up on the public privacy page —
// never tune them in passing.
//
// feedback-responses added 2026-08-06 at 12 months, confirmed by Mat under the
// same rule. Deliberately the shortest window in the schedule, and a third of
// the survey's 36 months: survey answers are structurally anonymous by
// construction, but a feedback comment is free text a visitor can type their
// own phone number into — the one store where the LENGTH of the window is
// itself the risk. NOTE: this added a data category to the published schedule
// without bumping PRIVACY_NOTICE_VERSION, because that bump re-prompts every
// version-gated consent (the geo card). Whether the Chamber wants that prompt
// is their call, not a side effect of shipping a widget.

/**
 * Version of the public privacy notice. Bumping this re-prompts every
 * version-gated consent (the geo consent card keys off it) BY DESIGN — the
 * E16/R3 membership-records tense flip relies on exactly that behavior.
 * Format: "YYYY-MM" of the notice revision.
 */
export const PRIVACY_NOTICE_VERSION = "2026-08";

export interface PrivacyNoticeChange {
  version: string;
  date: string; // ISO date the revision took effect
  summary: string;
}

/** Rendered on /privacy; newest first. */
export const PRIVACY_NOTICE_CHANGELOG: PrivacyNoticeChange[] = [
  {
    version: "2026-08",
    date: "2026-08-06",
    summary:
      "Page feedback: a rating, a comment, and the page it was sent from, kept 12 months. Added because the comment box is free text — the notice now says plainly what happens to personal details typed into it, and how to have them deleted.",
  },
  {
    version: "2026-07",
    date: "2026-07-20",
    summary:
      "First versioned notice: area-only location analytics, k-anonymity on published counts, retention schedule, consumer access/delete requests.",
  },
];

/**
 * K-anonymity floor for published aggregates: a named-area bucket must have
 * at least this many DISTINCT SESSIONS before it may appear in any summary;
 * smaller buckets collapse into BELOW_K_BUCKET (totals preserved). Small-town
 * counts of 1 are re-identifiable — this is the fix ROADMAP-V2 §6 named.
 */
export const K_FLOOR = 5;

/** Bucket id that absorbs below-floor rows in every published aggregate. */
export const BELOW_K_BUCKET = "below-threshold";
export const BELOW_K_BUCKET_LABEL = `Fewer than ${K_FLOOR} sessions, grouped for privacy`;

export type RetentionAction =
  | "rollup-then-delete" // aggregate into analytics_area_rollup, then delete raw rows
  | "delete" // hard-delete past the window (records: physical delete, not tombstone)
  | "redact-at-resolution" // PII scrubbed when the owning item resolves (no time window)
  | "self-pruning" // store prunes itself; documented here, owned elsewhere
  | "never-purge"; // excluded from every purge, forever

export interface RetentionRule {
  /** Stable id the purge job dispatches on. */
  store: string;
  /** Plain-language description rendered on /privacy. */
  description: string;
  /** Human-readable window rendered on /privacy. */
  label: string;
  /** Machine window: whole days … */
  windowDays?: number;
  /** … or calendar months (the purge job uses real date arithmetic). */
  windowMonths?: number;
  action: RetentionAction;
  /** True when another module owns the mechanism (documented, not executed here). */
  ownedElsewhere?: boolean;
}

/**
 * The retention schedule. The purge job (scripts/privacy-retention.ts)
 * executes EXACTLY these entries and /privacy renders EXACTLY these entries.
 * The audit table's never-purge entry is a floor, not a default: the purge
 * script additionally hardcodes its own refusal to touch that table.
 */
export const RETENTION_POLICY: RetentionRule[] = [
  {
    store: "analytics-geo-pings",
    description:
      "Opt-in “near me” location counts, stored as neighborhood-area buckets only (never coordinates). Rolled up into monthly area totals, then the raw events are deleted.",
    label: "90 days, then monthly area totals only",
    windowDays: 90,
    action: "rollup-then-delete",
  },
  {
    store: "event-going",
    description:
      "\u201cI\u2019m going\u201d tallies for lodging-tax reporting: a count per event plus the ZIP you optionally tell us you are visiting from. A running total, not a record of individual taps \u2014 nothing identifies who pressed the button.",
    label: "36 months",
    windowDays: 1095,
    action: "delete",
  },
  {
    store: "analytics-events",
    description:
      "Anonymous page views, outbound-link taps, and consent confirmations (a session id that resets when your browser closes; no cookies, no IP addresses).",
    label: "25 months",
    windowMonths: 25,
    action: "delete",
  },
  {
    store: "survey-responses",
    description:
      "Anonymous visitor-survey answers (distance band, overnight stay, party size). Never tied to a person or device.",
    label: "36 months",
    windowMonths: 36,
    action: "delete",
  },
  {
    store: "feedback-responses",
    description:
      "Ratings and comments you send through the feedback tab, with the page you sent them from. The form never asks who you are; please don't type your name or contact details into it.",
    label: "12 months",
    windowMonths: 12,
    action: "delete",
  },
  {
    store: "hunt-submissions",
    description:
      "Scavenger-hunt check-in photos and, when you allowed it, the precise check-in location you chose to send. Submission and photo are destroyed together; the audit trail keeps a coordinate-free record that a submission existed.",
    label: "12 months",
    windowMonths: 12,
    action: "delete",
  },
  {
    store: "worklist-request-contacts",
    description:
      "The contact you give us to answer a privacy or accuracy request. Redacted from the request record once the request is resolved.",
    label: "Until the request is resolved",
    action: "redact-at-resolution",
  },
  {
    store: "ferry-observations",
    description:
      "Ferry-schedule observations (no personal data). The ferry store prunes itself.",
    label: "90 days (self-pruning)",
    windowDays: 90,
    action: "self-pruning",
    ownedElsewhere: true,
  },
  {
    store: "volunteer_signup",
    description:
      "Volunteer shift signups (a name and one contact — email or phone). The name and contact are removed 45 days after the shift date; the anonymous signup record is kept so organizations can see aggregate turnout.",
    label: "45 days after the shift date, then anonymized",
    windowDays: 45,
    // Executed by the E20 volunteer sweep (/api/volunteer/reminders), not
    // the generic purge job: the window is SHIFT-date-relative, which
    // scripts/privacy-retention.ts's created-at arithmetic cannot model.
    action: "self-pruning",
    ownedElsewhere: true,
  },
  {
    store: "audit",
    description:
      "The append-only operations audit trail (who changed what, when — the Chamber's records floor). Never purged, never edited.",
    label: "Kept permanently (records floor)",
    action: "never-purge",
  },
];

/**
 * Food/health-assistance destinations: outbound taps to these hosts are
 * NEVER persisted — dropped entirely at the ingest trust boundary (and
 * mirrored client-side). Suffix match: the entry matches itself and any
 * subdomain. The floor is never-track, not track-less: there is no
 * count-only fallback. Extend this list as the community directory grows.
 */
export const SENSITIVE_DESTINATIONS: string[] = ["sharenetfoodbank.org"];

/**
 * In-app path prefixes whose events are never persisted (a future
 * food-assistance page registers here). Empty today — the mechanism ships
 * ahead of the page so the page can never launch untracked-by-accident.
 */
export const SENSITIVE_PATHS: string[] = [];

function hostMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/** Lowercase + strip trailing dots: the FQDN form "host.example.org." names
 *  the same server as "host.example.org" and must match the same rules. */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "");
}

/** Domains reachable through a mailto: href — every address's part after the
 *  last "@". A tap on a mailto link is an interaction with the destination
 *  org just like a website tap; the never-track rule sees through the scheme. */
function mailtoDomains(url: URL): string[] {
  let addressPart = url.pathname;
  try {
    addressPart = decodeURIComponent(addressPart);
  } catch {
    // keep the raw form; a %-mangled address still carries its plain domain
  }
  return addressPart
    .split(",")
    .map((addr) => {
      const at = addr.lastIndexOf("@");
      return at >= 0 ? normalizeHost(addr.slice(at + 1).trim()) : "";
    })
    .filter(Boolean);
}

/**
 * True when an outbound href points at a sensitive destination — by website
 * host (any subdomain; trailing-dot FQDN normalized) or by mailto: address
 * domain (the /give "Raise your hand" links are mailto:, and a food-bank
 * contact email is exactly as identifying as its website). Unparseable input
 * returns false — malformed hrefs are already truncated/bounded upstream and
 * cannot name a real destination; treating garbage as sensitive would let a
 * hostile client suppress arbitrary events. The list parameter exists for
 * tests; production callers use the default.
 */
export function isSensitiveOutbound(
  href: string,
  destinations: readonly string[] = SENSITIVE_DESTINATIONS,
): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const hostname = normalizeHost(url.hostname);
  if (hostname) {
    return destinations.some((d) => hostMatches(hostname, d));
  }
  if (url.protocol === "mailto:") {
    const domains = mailtoDomains(url);
    return domains.some((dom) => destinations.some((d) => hostMatches(dom, d)));
  }
  return false;
}

/**
 * True when an in-app path falls under a sensitive path prefix. Segment
 * boundary, not raw startsWith: "/food-assistance" matches itself and
 * "/food-assistance/hours", never "/food-assistance-fair".
 */
export function isSensitivePath(
  path: string,
  prefixes: readonly string[] = SENSITIVE_PATHS,
): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}
