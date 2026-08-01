// Launch hardening — site-wide security headers (source half; the served half
// is tests/server/security-headers.test.ts against the standalone build).
//
// Prod served ZERO security headers as of 2026-07-31 (curl-verified). This
// suite pins the next.config.ts contract so a config refactor cannot silently
// drop a header, weaken HSTS, or — the two easy-to-get-wrong bits — flip the
// CSP from Report-Only to enforced before the post-launch rollout, or
// "harden" Permissions-Policy into geolocation=() and break the
// side-switcher / near-me / hunt check-ins.

import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function loadRules(): Promise<HeaderRule[]> {
  if (!nextConfig.headers) throw new Error("next.config.ts no longer declares headers()");
  return (await nextConfig.headers()) as HeaderRule[];
}

function headerMap(rule: HeaderRule): Map<string, string> {
  return new Map(rule.headers.map((h) => [h.key, h.value]));
}

describe("next.config security headers", () => {
  it("disables the x-powered-by leak", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("keeps the E13 /sw.js no-cache rule intact", async () => {
    const rules = await loadRules();
    const sw = rules.find((r) => r.source === "/sw.js");
    expect(sw, "the /sw.js header rule is a stale-service-worker guard — do not remove").toBeDefined();
    expect(headerMap(sw!).get("Cache-Control")).toBe("no-cache, no-store, max-age=0");
  });

  it("sets the full security set on every path", async () => {
    const rules = await loadRules();
    const all = rules.find((r) => r.source === "/(.*)");
    expect(all, "the site-wide /(.*) security rule is missing").toBeDefined();
    expect([...headerMap(all!).keys()].sort()).toEqual(
      [
        "Content-Security-Policy-Report-Only",
        "Permissions-Policy",
        "Referrer-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
    const h = headerMap(all!);
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("scopes HSTS to this host only — no preload, no includeSubDomains", async () => {
    // The apex explorekingstonwa.com stays on WordPress/NameHero and the other
    // subdomains are not ours to commit; preload/includeSubDomains would be a
    // near-irreversible promise made on someone else's behalf.
    const rules = await loadRules();
    const hsts = headerMap(rules.find((r) => r.source === "/(.*)")!).get(
      "Strict-Transport-Security",
    );
    expect(hsts).toBe("max-age=15552000");
  });

  it("keeps geolocation available to the app in Permissions-Policy", async () => {
    // The side-switcher, near-me sort, and hunt check-ins all call
    // navigator.geolocation — geolocation=() would break them silently.
    const rules = await loadRules();
    const pp = headerMap(rules.find((r) => r.source === "/(.*)")!).get("Permissions-Policy")!;
    expect(pp).toContain("geolocation=(self)");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("payment=()");
  });

  it("ships CSP as Report-Only with the documented carve-outs, never enforced", async () => {
    const rules = await loadRules();
    // Enforcement is a deliberate post-launch task: kiosk, MapLibre editors and
    // admin are too many surfaces to enforce untested days before launch.
    for (const rule of rules) {
      for (const { key } of rule.headers) {
        expect(key.toLowerCase(), "enforced CSP must not ship before the post-launch rollout").not.toBe(
          "content-security-policy",
        );
      }
    }
    const csp = headerMap(rules.find((r) => r.source === "/(.*)")!).get(
      "Content-Security-Policy-Report-Only",
    )!;
    expect(csp).toContain("default-src 'self'");
    // RSC/Next bootstrap + JSON-LD render inline scripts.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    // MapLibre injects style elements.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // Map canvases/sprites + WSDOT webcams (src/lib/data/webcams.ts hotlinks
    // images.wsdot.wa.gov).
    expect(csp).toContain("img-src 'self' data: blob: https://images.wsdot.wa.gov");
    // pmtiles are same-origin via /api/map/tiles/* — no external connect needed.
    expect(csp).toContain("connect-src 'self'");
    // MapLibre spawns its workers from blob: URLs.
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'self'");
  });
});
