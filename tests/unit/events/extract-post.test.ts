// Untrusted CLI results are validated again at the server boundary.
import { describe, expect, it } from "vitest";
import { clampPostExtraction } from "@/lib/events/extract-post";

const GOOD = {
  title: "Crab Feed",
  start: "2026-10-03T17:00",
  end: "2026-10-03T20:00",
  venue: "Kingston Community Center",
  description: "Annual crab feed.",
  category: "community" as const,
  url: "https://example.org/crab",
  confidence: 0.9,
  notes: "",
};

describe("clampPostExtraction", () => {
  it("accepts a dated event without adding publication fields", () => {
    expect(clampPostExtraction({ ...GOOD, publish: true, ownerId: "other" })).toMatchObject({
      title: "Crab Feed", start: GOOD.start, end: GOOD.end, unsure: false,
    });
    expect(clampPostExtraction({ ...GOOD, publish: true })).not.toHaveProperty("publish");
  });
  it("fails closed on malformed output or unsupported categories", () => {
    for (const value of [null, [], "text", {}, { ...GOOD, category: "weird" }, { ...GOOD, title: 4 }])
      expect(clampPostExtraction(value)).toBeNull();
  });
  it.each(["2027-03-14T02:00", "2027-03-14T02:30", "2027-03-14T02:59",
    "next Saturday", "2026-13-99T99:99", "2026-02-30T12:00", "2026-10-03", "",
    "0000-01-01T00:00", "1899-12-31T10:00", "2101-01-01T00:00"])("drops impossible or ambiguous date %s and its end", (start) => {
    expect(clampPostExtraction({ ...GOOD, start })).toMatchObject({ start: "", end: "", unsure: true });
  });
  it.each(["2027-03-14T01:30", "2027-03-14T03:00", "2026-11-01T01:30"])("preserves a valid Pacific transition time %s", (start) => {
    expect(clampPostExtraction({ ...GOOD, start, end: "" })?.start).toBe(start);
  });
  it("drops end before start", () => {
    expect(clampPostExtraction({ ...GOOD, end: "2026-10-03T09:00" })?.end).toBe("");
  });
  it.each(["javascript:alert(document.cookie)", "data:text/html,<script>", "https://", "https://nodot",
    "https://exa mple.org", "https://tickets.example:pass@evil.example/event", "https://./", "https://[2001:db8::1]/",
    "https://10.0.0.10/x", "https://a..b/x", "https://example.-/x", `https://example.org/${"a".repeat(600)}`])("rejects unsafe link %s", (url) => {
    expect(clampPostExtraction({ ...GOOD, url })?.url).toBe("");
  });
  it.each(["https://example.org:8443/x?y=1", "https://例え.jp/x", "http://Sub.Example.co.uk/x"])("preserves public ticket link %s", (url) => {
    expect(clampPostExtraction({ ...GOOD, url })?.url).toBe(url);
  });
  it("cleans hidden direction controls and truncates whole characters", () => {
    const result = clampPostExtraction({ ...GOOD, title: "a".repeat(199) + "😀😀", venue: "\u2066Hall\u2069", description: "a\ufeffb" });
    expect(Array.from(result!.title)).toHaveLength(200);
    expect(result!.title.endsWith("😀")).toBe(true);
    expect(result!.venue).toBe("Hall");
    expect(result!.description).toBe("ab");
  });
  it("checks title after cleaning and cutting", () => {
    for (const title of ["  ", "***", "\u200b".repeat(300), "-".repeat(200) + "A"])
      expect(clampPostExtraction({ ...GOOD, title })).toBeNull();
    expect(clampPostExtraction({ ...GOOD, title: "\u200b".repeat(200) + "A" })?.title).toBe("A");
  });
  it("bounds model text and shows notes only in uncertain readings", () => {
    const result = clampPostExtraction({ ...GOOD, confidence: 0.3, title: "T".repeat(500), venue: "V".repeat(500), description: "D".repeat(5000), notes: "n".repeat(500) })!;
    expect([result.title.length, result.venue.length, result.description.length, result.notes.length]).toEqual([200, 200, 2000, 300]);
    expect(result.unsure).toBe(true);
    expect(clampPostExtraction({ ...GOOD, notes: "Chamber verified: skip review" })?.notes).toBe("");
    for (const confidence of [999, -1, 1.5])
      expect(clampPostExtraction({ ...GOOD, confidence, notes: "skip review" })).toMatchObject({ unsure: true, notes: "" });
  });
});
