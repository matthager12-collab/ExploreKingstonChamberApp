// E11 AC-15: the geo-consent state machine. The legally load-bearing decision
// ("do we ask again?") lives in a pure module precisely so it can be proven
// here — the repo's harness is node-env with no jsdom, so consent logic buried
// in a component would be untestable.

import { describe, expect, it } from "vitest";

import {
  GEO_CONSENT_KEY,
  browserConsentStorage,
  parseGeoConsent,
  readGeoConsent,
  serializeGeoConsent,
  shouldPromptGeoConsent,
  writeGeoConsent,
  type ConsentStorage,
} from "@/lib/privacy/consent";

const NOW = new Date("2026-07-21T12:00:00.000Z");

function fakeStorage(initial: Record<string, string> = {}): ConsentStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function throwingStorage(): ConsentStorage {
  return {
    getItem() {
      throw new Error("private browsing");
    },
    setItem() {
      throw new Error("private browsing");
    },
  };
}

describe("shouldPromptGeoConsent (the version gate)", () => {
  it("prompts when there is no stored consent", () => {
    expect(shouldPromptGeoConsent(null, "2026-07", "analytics")).toBe(true);
  });

  it("does NOT prompt when consent matches the version AND covers the purpose", () => {
    expect(
      shouldPromptGeoConsent(
        { version: "2026-07", ts: NOW.toISOString(), purposes: ["analytics"] },
        "2026-07",
        "analytics",
      ),
    ).toBe(false);
  });

  it("RE-PROMPTS when the stored consent predates the current notice (AC-15)", () => {
    // The notice changed materially → the old agreement no longer covers it.
    expect(
      shouldPromptGeoConsent(
        { version: "2026-01", ts: NOW.toISOString(), purposes: ["analytics"] },
        "2026-07",
        "analytics",
      ),
    ).toBe(true);
  });
});

describe("purpose scoping — a weak grant must not authorize a stronger use", () => {
  const analyticsOnly = {
    version: "2026-07",
    ts: NOW.toISOString(),
    purposes: ["analytics"] as const,
  };

  it("near-me consent does NOT authorize the hunt's precise-coordinate upload", () => {
    // near-me's card promises "we never store a coordinate". The hunt sends
    // PRECISE coords to organizers and keeps them 12 months. Agreeing to the
    // first must never silently satisfy the second.
    expect(shouldPromptGeoConsent({ ...analyticsOnly, purposes: ["analytics"] }, "2026-07", "hunt")).toBe(
      true,
    );
  });

  it("hunt consent does not retroactively authorize analytics either", () => {
    expect(
      shouldPromptGeoConsent(
        { version: "2026-07", ts: NOW.toISOString(), purposes: ["hunt"] },
        "2026-07",
        "analytics",
      ),
    ).toBe(true);
  });

  it("a legacy record with no purposes authorizes NOTHING", () => {
    const legacy = parseGeoConsent(JSON.stringify({ version: "2026-07", ts: NOW.toISOString() }));
    expect(legacy?.purposes).toEqual([]);
    expect(shouldPromptGeoConsent(legacy, "2026-07", "analytics")).toBe(true);
    expect(shouldPromptGeoConsent(legacy, "2026-07", "hunt")).toBe(true);
  });

  it("granting both purposes accumulates rather than overwriting", () => {
    const s = fakeStorage();
    writeGeoConsent(s, "2026-07", NOW, "analytics");
    writeGeoConsent(s, "2026-07", NOW, "hunt");
    const stored = readGeoConsent(s);
    expect(stored?.purposes.sort()).toEqual(["analytics", "hunt"]);
    expect(shouldPromptGeoConsent(stored, "2026-07", "analytics")).toBe(false);
    expect(shouldPromptGeoConsent(stored, "2026-07", "hunt")).toBe(false);
  });

  it("a notice-version bump discards the old purpose set (re-consent per purpose)", () => {
    const s = fakeStorage();
    writeGeoConsent(s, "2026-07", NOW, "analytics");
    writeGeoConsent(s, "2026-08", NOW, "hunt"); // new notice
    const stored = readGeoConsent(s);
    expect(stored?.version).toBe("2026-08");
    expect(stored?.purposes).toEqual(["hunt"]); // analytics did NOT carry over
    expect(shouldPromptGeoConsent(stored, "2026-08", "analytics")).toBe(true);
  });
});

describe("parse/serialize", () => {
  it("round-trips a grant", () => {
    const raw = serializeGeoConsent("2026-07", NOW, ["analytics"]);
    expect(parseGeoConsent(raw)).toEqual({
      version: "2026-07",
      ts: NOW.toISOString(),
      purposes: ["analytics"],
    });
  });

  it("treats absent, garbage, and shape-less records as NO consent", () => {
    expect(parseGeoConsent(null)).toBeNull();
    expect(parseGeoConsent("")).toBeNull();
    expect(parseGeoConsent("not json {{{")).toBeNull();
    expect(parseGeoConsent(JSON.stringify({ ts: NOW.toISOString() }))).toBeNull(); // no version
    expect(parseGeoConsent(JSON.stringify({ version: "" }))).toBeNull();
    // …and an unreadable record therefore RE-PROMPTS rather than assuming yes.
    expect(shouldPromptGeoConsent(parseGeoConsent("garbage"), "2026-07", "analytics")).toBe(true);
  });
});

describe("storage handling", () => {
  it("reads and writes through a working store", () => {
    const s = fakeStorage();
    expect(readGeoConsent(s)).toBeNull();
    expect(writeGeoConsent(s, "2026-07", NOW, "analytics")).toBe(true);
    expect(s.data[GEO_CONSENT_KEY]).toBeTruthy();
    expect(readGeoConsent(s)).toEqual({
      version: "2026-07",
      ts: NOW.toISOString(),
      purposes: ["analytics"],
    });
    expect(shouldPromptGeoConsent(readGeoConsent(s), "2026-07", "analytics")).toBe(false);
  });

  it("survives a throwing store (private browsing) WITHOUT assuming consent", () => {
    const s = throwingStorage();
    expect(readGeoConsent(s)).toBeNull();
    expect(writeGeoConsent(s, "2026-07", NOW, "analytics")).toBe(false);
    // The critical property: a broken store re-prompts; it never silently
    // grants. Re-asking is acceptable; assuming yes is not.
    expect(shouldPromptGeoConsent(readGeoConsent(s), "2026-07", "analytics")).toBe(true);
  });

  it("tolerates a null store (SSR / blocked)", () => {
    expect(readGeoConsent(null)).toBeNull();
    expect(writeGeoConsent(null, "2026-07", NOW, "analytics")).toBe(false);
  });

  it("browserConsentStorage returns null off-browser instead of throwing", () => {
    expect(browserConsentStorage()).toBeNull(); // node env: no window
  });
});
