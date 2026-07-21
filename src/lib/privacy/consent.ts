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

export interface GeoConsent {
  /** The PRIVACY_NOTICE_VERSION the visitor agreed to. */
  version: string;
  /** ISO timestamp of the grant (evidence, never sent anywhere). */
  ts: string;
}

/** Minimal Storage surface — lets tests inject a throwing or fake store. */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parse a stored consent blob. Returns null for absent/garbage/legacy shapes
 *  — an unreadable record is treated as NO consent, never as consent. */
export function parseGeoConsent(raw: string | null): GeoConsent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GeoConsent>;
    if (typeof v?.version !== "string" || !v.version) return null;
    return { version: v.version, ts: typeof v.ts === "string" ? v.ts : "" };
  } catch {
    return null;
  }
}

export function serializeGeoConsent(version: string, now: Date): string {
  return JSON.stringify({ version, ts: now.toISOString() } satisfies GeoConsent);
}

/**
 * The decision: ask again unless we hold a consent for EXACTLY the current
 * notice version. No consent, an unreadable one, or one granted against an
 * older notice all re-prompt.
 */
export function shouldPromptGeoConsent(
  stored: GeoConsent | null,
  currentVersion: string,
): boolean {
  return stored?.version !== currentVersion;
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

/** Persist consent; returns false when storage refused (caller keeps the
 *  grant in memory for this pageload only). */
export function writeGeoConsent(
  storage: ConsentStorage | null,
  version: string,
  now: Date,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GEO_CONSENT_KEY, serializeGeoConsent(version, now));
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
