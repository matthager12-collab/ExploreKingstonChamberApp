// The pure half of the business picker: the name rule, the cross-store
// de-dupe, and the organizer match. These decide which business an event is
// filed under on /events, so they get the same treatment as the calendar's
// pure core — tested without a database.

import { describe, expect, it } from "vitest";
import {
  dedupeBusinessOptions,
  matchOrganizer,
  normalizeBusinessName,
  OTHER_BUSINESS_VALUE,
  type BusinessOption,
} from "@/lib/businesses";

describe("normalizeBusinessName", () => {
  it("folds the ways one business gets written down", () => {
    const forms = [
      "The Filling Station",
      "Filling Station",
      "Filling Station, LLC",
      "FILLING STATION",
      "Filling  Station",
    ];
    const normalized = new Set(forms.map(normalizeBusinessName));
    expect(normalized).toEqual(new Set(["filling station"]));
  });

  it("keeps genuinely different businesses apart", () => {
    expect(normalizeBusinessName("Kingston Ale House")).not.toBe(
      normalizeBusinessName("Kingston Coffee House"),
    );
  });

  it("does not eat a name that merely ends in a suffix-like word", () => {
    // "Co" as a whole trailing word goes; "Coffee" must not be truncated to it.
    expect(normalizeBusinessName("Mossback Co")).toBe("mossback");
    expect(normalizeBusinessName("Mossback Coffee")).toBe("mossback coffee");
  });
});

describe("dedupeBusinessOptions", () => {
  const curated: BusinessOption = { value: "eat:filling-station", label: "The Filling Station", kind: "eat" };
  const imported: BusinessOption = { value: "directory:fs-1843", label: "Filling Station, LLC", kind: "directory" };

  it("collapses a roster import onto the curated record it duplicates", () => {
    const out = dedupeBusinessOptions([imported, curated]);
    expect(out).toHaveLength(1);
    // Curated wins regardless of input order — its name is the one the
    // Chamber wrote, so it is the one a visitor recognizes.
    expect(out[0].value).toBe("eat:filling-station");
  });

  it("keeps distinct businesses and sorts them for a picker", () => {
    const out = dedupeBusinessOptions([
      { value: "give:rotary", label: "Kingston Rotary", kind: "give" },
      curated,
      { value: "stay:smugglers", label: "Smugglers Cove", kind: "stay" },
    ]);
    expect(out.map((o) => o.label)).toEqual([
      "Kingston Rotary",
      "Smugglers Cove",
      "The Filling Station",
    ]);
  });

  it("drops a nameless row rather than creating a blank option", () => {
    expect(dedupeBusinessOptions([{ value: "directory:x", label: "   ", kind: "directory" }])).toEqual([]);
  });
});

describe("matchOrganizer", () => {
  const options: BusinessOption[] = [
    { value: "eat:filling-station", label: "The Filling Station", kind: "eat" },
    { value: "give:rotary", label: "Kingston Rotary", kind: "give" },
  ];

  it("matches across the spelling differences the feeds actually carry", () => {
    expect(matchOrganizer("Filling Station LLC", options)).toBe("eat:filling-station");
    expect(matchOrganizer("the filling station", options)).toBe("eat:filling-station");
  });

  it("returns null rather than guessing at a near miss", () => {
    // Deliberate: a fuzzy match here would file an event under the wrong
    // member, and the caller turns null into an honest "other".
    expect(matchOrganizer("Filling Station Brewery", options)).toBeNull();
    expect(matchOrganizer("Some Person", options)).toBeNull();
  });

  it("treats an absent or blank organizer as no match", () => {
    expect(matchOrganizer(undefined, options)).toBeNull();
    expect(matchOrganizer("  ", options)).toBeNull();
  });

  it("never returns the 'other' sentinel — that is the caller's fallback", () => {
    expect(matchOrganizer("Anything Unmatched", options)).not.toBe(OTHER_BUSINESS_VALUE);
  });
});
