// THE list of businesses and organizations, as one pickable set — PURE half.
//
// The Chamber's members are spread across four stores for good reasons —
// restaurants render on /eat, lodging on /stay, charities on /give, and the
// GrowthZone import lands in `directory` — but a person filling in "who is
// running this event?" does not care which one a business happens to live in.
// This module is the union they see.
//
// PURE ON PURPOSE, and physically separate from the reader in
// src/lib/stores/business-options.ts: the filter UI on /events is a client
// component and needs the option type, the "other" sentinel and the matching
// rule. Anything importing `server-only` cannot cross that line, so the rule
// lives here and the store reads live there.
//
// Why not reuse dedupe's normalizeTitle: that function encodes CALENDAR policy
// and its thresholds are ask-first. Business-name matching must not shift the
// day someone tunes event dedupe, so it gets its own (currently identical in
// spirit) rule. Small duplication, deliberate.

/** Which store a business came from — drives the option-group heading. */
export type BusinessKind = "eat" | "stay" | "give" | "directory";

export interface BusinessOption {
  /** Stable picker value, "<kind>:<record id>". Namespaced because ids are
   *  only unique WITHIN a store. */
  value: string;
  label: string;
  kind: BusinessKind;
}

/** The escape hatch value. Anything not on the list is typed in free-text and
 *  stored as a plain name — see the events suggest form. */
export const OTHER_BUSINESS_VALUE = "other";

/** Curated records first: their names are the ones the Chamber wrote, so they
 *  win over a roster-imported directory row for the same business. */
export const BUSINESS_KIND_ORDER: BusinessKind[] = ["eat", "stay", "give", "directory"];

export const BUSINESS_KIND_LABEL: Record<BusinessKind, string> = {
  eat: "Food & drink",
  stay: "Lodging",
  give: "Nonprofits",
  directory: "Chamber directory",
};

/** Lowercase, strip punctuation and a leading article, collapse whitespace,
 *  and drop the corporate-suffix noise the roster import carries
 *  ("Filling Station, LLC" and "The Filling Station" are one business). */
export function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\s+(llc|inc|incorporated|co|corp|ltd)$/u, "")
    .replace(/^(the|a|an)\s+/u, "")
    .trim();
}

/**
 * Collapse the four stores' rows into one picker list: unique by normalized
 * name, curated stores winning, sorted for a human.
 *
 * De-duplication matters — the GrowthZone roster import creates a `directory`
 * record for members who ALREADY have a curated restaurant or lodging entry,
 * so without this the same brewery appears twice in the dropdown.
 */
export function dedupeBusinessOptions(all: BusinessOption[]): BusinessOption[] {
  const byName = new Map<string, BusinessOption>();
  for (const option of all) {
    const key = normalizeBusinessName(option.label);
    if (!key) continue;
    const held = byName.get(key);
    if (
      !held ||
      BUSINESS_KIND_ORDER.indexOf(option.kind) < BUSINESS_KIND_ORDER.indexOf(held.kind)
    ) {
      byName.set(key, option);
    }
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Best-effort map from a free-text organizer string to a picker value.
 *
 * Exact-after-normalization on purpose. A fuzzy match here would quietly file
 * an event under the wrong business, and the whole point of the controlled
 * field is that the attribution is right — an unmatched organizer is honestly
 * "other", not a guess. Returns null when nothing matches.
 */
export function matchOrganizer(
  organizer: string | undefined,
  options: BusinessOption[],
): string | null {
  const key = normalizeBusinessName(organizer ?? "");
  if (!key) return null;
  const hit = options.find((o) => normalizeBusinessName(o.label) === key);
  return hit?.value ?? null;
}
