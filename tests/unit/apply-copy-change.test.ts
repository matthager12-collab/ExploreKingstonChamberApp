// The pure core of the copy-change workflow: swapping one block's fallback for
// requested wording. Covers the simple case, the E14-commented/multiline case,
// escaping, and the failure modes that keep a bad edit out of the PR.

import { describe, it, expect } from "vitest";
import { applyCopyChange, parsePayload } from "../../scripts/apply-copy-change.mjs";

const SAMPLE = `export const COPY_BLOCKS = [
  {
    key: "eat.header.title",
    page: "Eat & Drink",
    label: "Page title",
    fallback: "Eat & Drink",
  },
  {
    key: "ferry.header.intro",
    page: "Ferry",
    label: "Intro sentence",
    multiline: true,
    // E14 plain-language pass (NFR-04): a comment sits between the fields here.
    fallback:
      "Two boats serve Kingston.",
  },
] as const;
`;

describe("applyCopyChange", () => {
  it("replaces a simple block's fallback and leaves siblings untouched", () => {
    const out = applyCopyChange(SAMPLE, "eat.header.title", "Food & Drink in town");
    expect(out).toContain('key: "eat.header.title"');
    expect(out).toContain('fallback: "Food & Drink in town"');
    expect(out).not.toContain('fallback: "Eat & Drink"');
    expect(out).toContain('"Two boats serve Kingston."'); // other block intact
  });

  it("handles a multiline / comment-separated (E14) block", () => {
    const out = applyCopyChange(SAMPLE, "ferry.header.intro", "Two boats — bikes welcome.");
    expect(out).toContain('"Two boats — bikes welcome."');
    expect(out).not.toContain('"Two boats serve Kingston."');
  });

  it("escapes quotes and newlines into a valid string literal", () => {
    const out = applyCopyChange(SAMPLE, "eat.header.title", 'She said "hi"\nline two');
    expect(out).toContain('fallback: "She said \\"hi\\"\\nline two"');
  });

  it("throws on an unknown key", () => {
    expect(() => applyCopyChange(SAMPLE, "nope.not.real", "x")).toThrow(/not found/);
  });

  it("throws on empty requested wording", () => {
    expect(() => applyCopyChange(SAMPLE, "eat.header.title", "   ")).toThrow(/empty/);
  });
});

describe("parsePayload", () => {
  it("decodes a base64 JSON payload from an issue body", () => {
    const data = { key: "eat.header.title", text: "New wording" };
    const b64 = Buffer.from(JSON.stringify(data)).toString("base64");
    const body = `Some prose\n\n<!-- copy-change-data: ${b64} -->`;
    expect(parsePayload(body)).toEqual(data);
  });

  it("returns null when there is no marker", () => {
    expect(parsePayload("just a normal issue")).toBeNull();
    expect(parsePayload("")).toBeNull();
  });
});
