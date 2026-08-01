// Mechanical USPS-style street-name abbreviation (owner request 2026-08-01:
// "use USPS abbreviations and increase the amount of named streets").
//
// The vector tiles carry full OSM names ("Northeast State Highway 104") and no
// short_name attribute, and MapLibre expressions cannot string-replace — so the
// style needs abbreviated forms computed AHEAD of time. This module is the one
// place the rules live; `scripts/derive-street-abbrevs.ts` applies them to every
// road name in the served archive and emits `street-abbrevs.json`, which
// `basemap.ts` folds into a ["match"] expression (full name -> abbreviated).
//
// MECHANICAL RULES ONLY — no invented nicknames, no dropped words. "Northeast
// State Highway 104" becomes "NE State Hwy 104", never "SR 104" (that would be
// a rename, not an abbreviation). The rules, in order:
//
//   1. Post-directional: a full directional word as the LAST token abbreviates
//      (…"Avenue West" -> "Ave W"). Case-insensitive (OSM has one lowercase
//      "northeast"), output is the canonical USPS form.
//   2. Pre-directional: a full directional word as the FIRST token abbreviates
//      ("Northeast West Kingston Road" -> "NE West Kingston Rd") — but ONLY
//      when the name has no post-directional. Around Kingston a directional at
//      BOTH ends means the leading word is part of the place name, not a
//      directional: "South Kingston Road Northeast" is the road to South
//      Kingston and must stay "South Kingston Rd NE" (county signage agrees),
//      not "S Kingston Rd NE".
//   3. Suffix: the word in the final suffix slot — the last token after
//      stripping a post-directional and then a trailing number — abbreviates
//      per USPS Publication 28 ("State Highway 104" -> "State Hwy 104";
//      "100th Avenue West" -> "100th Ave W"). Only that one word: an interior
//      suffix word is part of the name ("Arbors Terrace Rd NE" keeps Terrace).
//
// Directionals mid-name never abbreviate (the "West" in "Northeast West
// Kingston Road" is the West Kingston area). Already-abbreviated tokens ("Rd",
// "NE") match nothing here, which makes the function idempotent — OSM ships a
// handful of pre-abbreviated names ("Arborwood Dr NE") and they pass through
// byte-identical.
//
// SUFFIXES is the owner's enumerated Publication 28 set plus Terrace (Pub 28
// TER, present in local addresses: "10th Terrace Northwest"). Deliberately NOT
// mapped: Way and Loop (Pub 28 keeps both unabbreviated), Trail (Pub 28 has
// TRL, but our named trails are recreational features, not addresses — "Trl"
// on a tourist map reads worse than it saves), and Route ("State Route 104"
// stays spelled out; USPS has no Route abbreviation and shortening it drifts
// toward the forbidden "SR 104" rename).

export const DIRECTIONALS: Record<string, string> = {
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  northeast: "NE",
  northwest: "NW",
  southeast: "SE",
  southwest: "SW",
};

export const SUFFIXES: Record<string, string> = {
  street: "St",
  road: "Rd",
  avenue: "Ave",
  lane: "Ln",
  drive: "Dr",
  boulevard: "Blvd",
  court: "Ct",
  place: "Pl",
  circle: "Cir",
  highway: "Hwy",
  terrace: "Ter",
};

/** The canonical abbreviated directionals, for recognizing already-short forms. */
const DIRECTIONAL_ABBREVS = new Set(Object.values(DIRECTIONALS));

/**
 * Abbreviate one street name per the mechanical USPS rules above. Returns the
 * input unchanged when no rule applies. Pure and idempotent.
 */
export function abbreviateStreetName(name: string): string {
  const tokens = name.split(" ").filter((t) => t.length > 0);
  if (tokens.length < 2) return name;

  const last = tokens[tokens.length - 1];
  const lastIsFullDirectional = DIRECTIONALS[last.toLowerCase()] !== undefined;
  // A trailing "NE"/"W"/… counts as a post-directional for the both-ends guard
  // (rule 2) even though it needs no abbreviating itself.
  const hasPostDirectional = lastIsFullDirectional || DIRECTIONAL_ABBREVS.has(last);

  // Rule 1 — post-directional.
  if (lastIsFullDirectional) {
    tokens[tokens.length - 1] = DIRECTIONALS[last.toLowerCase()];
  }

  // Rule 2 — pre-directional, only without a post-directional.
  const first = tokens[0];
  if (!hasPostDirectional && DIRECTIONALS[first.toLowerCase()] !== undefined) {
    tokens[0] = DIRECTIONALS[first.toLowerCase()];
  }

  // Rule 3 — the final suffix slot: last token, skipping a post-directional
  // and then one trailing number ("State Highway 104" / "State Hwy 104 NE").
  let i = tokens.length - 1;
  if (hasPostDirectional) i--;
  if (i >= 0 && /^\d+$/.test(tokens[i])) i--;
  if (i > 0 && SUFFIXES[tokens[i].toLowerCase()] !== undefined) {
    tokens[i] = SUFFIXES[tokens[i].toLowerCase()];
  }

  return tokens.join(" ");
}
