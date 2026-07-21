// E11 affirmative-consent state machine (FR-A21 / M-15-01).
//
// PURE and storage-injected on purpose: the consent decision is the legally
// load-bearing bit, so it lives here — unit-testable in the node-env suite —
// while the components stay thin surfaces over it. (The repo's test harness
// has no jsdom, so logic that matters must not be trapped inside a component.)
//
// Consent is VERSION-GATED against PRIVACY_NOTICE_VERSION: when the notice
// changes materially the version bumps and everyone is asked again. That
// re-prompt is the intended behavior, not a bug — see docs/PRIVACY.md.
//
// Storage throws in private-browsing modes. Every access is wrapped; on
// failure we fall back to per-pageload memory, which means the visitor may be
// asked again in a new tab. Re-prompting is acceptable; silently ASSUMING
// consent is not.

export const GEO_CONSENT_KEY = "vk-consent-geo";

/**
 * Consent is PER-PURPOSE, not one blanket location permission. The two
 * surfaces ask for materially different things:
 *
 *   "analytics" — near-me: a reading classified to a neighborhood on the
 *                 server, coordinates discarded. The card promises "we never
 *                 store a coordinate."
 *   "hunt"      — scavenger hunt: your PRECISE coordinates travel with your
 *                 photo to the hunt organizers and are kept 12 months.
 *
 * Agreeing to the first must never silently authorize the second — that would
 * make the near-me card's promise false for data collected under it. Each
 * purpose is granted separately and recorded separately.
 */
export type ConsentPurpose = "analytics" | "hunt";

export interface GeoConsent {
  /** The PRIVACY_NOTICE_VERSION the visitor agreed to. */
  version: string;
  /** ISO timestamp of the most recent grant (evidence, never sent anywhere). */
  ts: string;
  /** Which purposes were granted. A record without this field is a legacy
   *  (pre-purpose-scoping) grant and authorizes NOTHING — it re-prompts. */
  purposes: ConsentPurpose[];
}

/** Minimal Storage surface — lets tests inject a throwing or fake store. */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PURPOSES: readonly string[] = ["analytics", "hunt"];

/** Parse a stored consent blob. Returns null for absent/garbage shapes — an
 *  unreadable record is treated as NO consent, never as consent. A record
 *  with no (or a malformed) `purposes` list parses with an EMPTY purpose set,
 *  which authorizes nothing: legacy grants re-prompt per purpose. */
export function parseGeoConsent(raw: string | null): GeoConsent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GeoConsent>;
    if (typeof v?.version !== "string" || !v.version) return null;
    const purposes = Array.isArray(v.purposes)
      ? (v.purposes.filter((p) => PURPOSES.includes(p as string)) as ConsentPurpose[])
      : [];
    return { version: v.version, ts: typeof v.ts === "string" ? v.ts : "", purposes };
  } catch {
    return null;
  }
}

export function serializeGeoConsent(
  version: string,
  now: Date,
  purposes: ConsentPurpose[],
): string {
  return JSON.stringify({
    version,
    ts: now.toISOString(),
    purposes: [...new Set(purposes)],
  } satisfies GeoConsent);
}

/**
 * The decision, PER PURPOSE: ask again unless we hold a consent for EXACTLY
 * the current notice version that explicitly covers this purpose. No consent,
 * an unreadable one, one granted against an older notice, or one granted for a
 * DIFFERENT purpose all re-prompt.
 *
 * The purpose argument is required on purpose: a caller cannot accidentally
 * ask "do we have location consent?" in the abstract and get a yes that was
 * given for something else.
 */
export function shouldPromptGeoConsent(
  stored: GeoConsent | null,
  currentVersion: string,
  purpose: ConsentPurpose,
): boolean {
  if (!stored || stored.version !== currentVersion) return true;
  return !stored.purposes.includes(purpose);
}

/** Read consent through storage, tolerating a throwing store. */
export function readGeoConsent(storage: ConsentStorage | null): GeoConsent | null {
  if (!storage) return null;
  try {
    return parseGeoConsent(storage.getItem(GEO_CONSENT_KEY));
  } catch {
    return null; // private browsing → treat as not-yet-consented
  }
}

/**
 * Grant ONE purpose and persist. Existing purposes for the SAME notice version
 * are preserved (consenting to the hunt later keeps an earlier analytics
 * grant); a version change discards the old set, because the visitor agreed to
 * a different notice. Returns false when storage refused — the caller keeps
 * the grant in memory for this pageload only.
 */
export function writeGeoConsent(
  storage: ConsentStorage | null,
  version: string,
  now: Date,
  purpose: ConsentPurpose,
): boolean {
  if (!storage) return false;
  try {
    const existing = parseGeoConsent(storage.getItem(GEO_CONSENT_KEY));
    const carried = existing?.version === version ? existing.purposes : [];
    storage.setItem(GEO_CONSENT_KEY, serializeGeoConsent(version, now, [...carried, purpose]));
    return true;
  } catch {
    return false;
  }
}

/** The browser's localStorage, or null when unavailable (SSR / blocked). */
export function browserConsentStorage(): ConsentStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
