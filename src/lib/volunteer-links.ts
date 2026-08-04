// E20 volunteer action links — pure module (no fs/db; env read only for the
// secret and site origin), imitating src/lib/auth's HMAC-base64url pattern.
//
// A signup has no account, so authority over it is carried by purpose-scoped
// HMAC tokens embedded in the confirmation/reminder emails: `cancel`,
// `confirm`, and `checkin` each get a DIFFERENT token for the same signup —
// a leaked cancel link can never check anyone in. Tokens are deterministic
// (no expiry state): the manage surface goes dead when the retention sweep
// anonymizes the row, which is the actual lifetime bound we want.

import { createHmac, timingSafeEqual } from "node:crypto";

import { siteUrl } from "@/lib/site-url";
import type { VolunteerNeed } from "@/lib/types";
import { pacificWallTimeToISO } from "@/lib/time";

export type VolunteerTokenPurpose = "cancel" | "confirm" | "checkin";

/** VOLUNTEER_LINK_SECRET, falling back to AUTH_SECRET (documented in
 *  docs/DEPLOY.md) so a fresh environment isn't silently tokenless. */
function linkSecret(): string {
  const s = process.env.VOLUNTEER_LINK_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("VOLUNTEER_LINK_SECRET or AUTH_SECRET must be set");
  return s;
}

export function signupActionToken(signupId: string, purpose: VolunteerTokenPurpose): string {
  return createHmac("sha256", linkSecret())
    .update(`volunteer:${purpose}:${signupId}`)
    .digest("base64url");
}

export function verifySignupActionToken(
  signupId: string,
  purpose: VolunteerTokenPurpose,
  token: string,
): boolean {
  const expected = Buffer.from(signupActionToken(signupId, purpose));
  const provided = Buffer.from(token);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Absolute — these land in emails. Uses the repo's canonical origin helper
 *  (NEXT_PUBLIC_SITE_URL; docs/DEPLOY.md notes it must be set wherever
 *  volunteer email sends run). */
export function manageUrl(signupId: string): string {
  const token = signupActionToken(signupId, "cancel");
  return `${siteUrl()}/volunteer/manage/${encodeURIComponent(signupId)}?t=${token}`;
}

/* ---------------------------- shift start time --------------------------- */

/** The Pacific calendar day of the shift, from either `date` shape the store
 *  really contains (seed: full ISO instant with offset; portal: bare
 *  YYYY-MM-DD anchored at Pacific midnight). */
const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});

function pacificDayOf(dateIso: string): string | null {
  // A date-only string IS a Pacific calendar day — take it literally.
  // Parsing it would anchor at UTC midnight, which is the PREVIOUS Pacific
  // day (5 pm), silently shifting every reminder by a day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return null;
  return PACIFIC_DAY.format(new Date(t));
}

/** Leading clock time out of the free-text `timeRange`. The ONLY trusted
 *  shape is the one every seed record actually uses — "H:MM AM – …" — with
 *  an explicit meridiem. A bare "10:00–2:00" is ambiguous (10 at night?) and
 *  returns null rather than guessing: null just means "no T-2h reminder for
 *  this shift", which is the honest degradation the charter specifies. */
export function parseLeadingTime(timeRange: string): string | null {
  const m = /^\s*(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)\b/i.exec(timeRange);
  if (!m) return null;
  let hour = Number(m[1]);
  if (hour < 1 || hour > 12) return null;
  const minute = m[2] ?? "00";
  const pm = m[3].toUpperCase() === "PM";
  if (pm && hour !== 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

/**
 * The shift's start as an ISO instant: explicit `startTime` first, else the
 * parseable leading time of `timeRange`, else null (⇒ no T-2h reminder —
 * the sweep counts and reports these). Day-resolution comes from `date`'s
 * PACIFIC day, never its clock time: seeds anchor `date` at the start time
 * but the portal anchors at midnight, so the clock part of `date` is
 * unreliable by construction (charter context pack).
 */
export function shiftStartInstant(
  need: Pick<VolunteerNeed, "date" | "timeRange" | "startTime">,
): string | null {
  const day = pacificDayOf(need.date);
  if (!day) return null;
  const hhmm = need.startTime ?? parseLeadingTime(need.timeRange);
  if (!hhmm) return null;
  return pacificWallTimeToISO(day, hhmm);
}
