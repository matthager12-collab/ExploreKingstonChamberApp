import { describe, expect, it } from "vitest";
import { safeExternalHref } from "@/lib/safe-href";

// The render-side floor for store-fed hrefs: web URLs pass through, every
// other scheme (and every non-string) becomes "no link at all". The write
// paths validate first; this pins the last line regardless of writer.
describe("safeExternalHref", () => {
  it("passes web URLs through, trimmed", () => {
    expect(safeExternalHref("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(safeExternalHref("http://example.com")).toBe("http://example.com");
    expect(safeExternalHref("  https://example.com  ")).toBe("https://example.com");
    expect(safeExternalHref("HTTPS://EXAMPLE.COM")).toBe("HTTPS://EXAMPLE.COM");
  });

  it("refuses every non-web scheme", () => {
    // eslint-disable-next-line no-script-url -- the rejected input under test
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,hi")).toBeUndefined();
    expect(safeExternalHref("vbscript:x")).toBeUndefined();
    expect(safeExternalHref("file:///etc/hosts")).toBeUndefined();
    // Whitespace smuggling before the scheme.
    expect(safeExternalHref(" \tjavascript:alert(1)")).toBeUndefined();
  });

  it("refuses relative paths and garbage — external links are absolute", () => {
    expect(safeExternalHref("/events")).toBeUndefined();
    expect(safeExternalHref("example.com")).toBeUndefined();
    expect(safeExternalHref("//example.com")).toBeUndefined();
    expect(safeExternalHref("")).toBeUndefined();
  });

  it("refuses non-strings", () => {
    expect(safeExternalHref(null)).toBeUndefined();
    expect(safeExternalHref(undefined)).toBeUndefined();
  });
});
