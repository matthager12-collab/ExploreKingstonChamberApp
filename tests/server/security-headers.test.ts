// Launch hardening — security headers, served half. The source half is
// tests/unit/security-headers.test.ts; this suite asserts the headers on
// responses from the standalone production server, because headers() resolves
// at BUILD time into routes-manifest.json — this is the only tier that proves
// the built artifact actually serves them.

import { describe, expect, it } from "vitest";
import { BASE_URL } from "./config";

const EXPECTED: Array<[name: string, value: string]> = [
  ["strict-transport-security", "max-age=15552000"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "SAMEORIGIN"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "geolocation=(self), camera=(), microphone=(), payment=()"],
];

describe("security headers on served responses", () => {
  it("serves the full set on a page route", async () => {
    const res = await fetch(BASE_URL + "/");
    expect(res.status).toBe(200);
    for (const [name, value] of EXPECTED) {
      expect(res.headers.get(name), name).toBe(value);
    }
    const csp = res.headers.get("content-security-policy");
    expect(csp, "enforced CSP header missing").toContain("default-src 'self'");
    // Enforced since the 2026-08-16 hardening pass — the Report-Only header
    // must be GONE, not doubled up (two policies would report confusingly).
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    // poweredByHeader:false — the framework leak must be gone.
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("combines with, not replaces, the /sw.js no-cache rule", async () => {
    // Both header rules match /sw.js with disjoint keys, so the E13
    // stale-service-worker guard and the security set must BOTH be present.
    const res = await fetch(BASE_URL + "/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, max-age=0");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=15552000");
  });

  it("covers API routes too", async () => {
    const res = await fetch(BASE_URL + "/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});
