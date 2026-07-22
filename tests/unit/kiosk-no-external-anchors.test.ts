// THE KIOSK LOCKDOWN FLOOR (E22, M-13-08 / FR-A36) — CI-blocking.
//
// Suite name: kiosk-no-external-anchors. Referenced by that name from
// src/components/kiosk-shell.tsx and src/app/(kiosk)/kiosk/map/page.tsx, both
// of which describe this file as the layer that fails the build.
//
// A kiosk must never open a third-party site in its own browser. That is how a
// visitor escapes the lockdown and strands a wall-mounted panel on somebody
// else's page, with no address bar and no back button, until a human notices.
// Everywhere the website renders an outbound link, the kiosk renders a QR code
// instead and the visitor's phone opens it.
//
// This suite reads the SOURCE of the kiosk tree rather than rendering it, on
// purpose. The screens are async server components that hit the database, so
// rendering them here would need a live store; and the failure being hunted is
// a link somebody adds later, which is visible in the source long before it is
// visible in a DOM. Runtime coverage exists too — the standalone-server probe
// asserts zero external anchors in the real HTML of every enabled screen.
//
// The layers this backs up: KioskShell cancels any click that would leave
// /kiosk, and the Chromium URL-allowlist policy on the device (see
// docs/KIOSK-DEPLOY.md) is the hard enforcement. This is the one that fails a
// PULL REQUEST, which is the cheapest place to catch it.

import { readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

/**
 * Every file that renders on a kiosk route.
 *
 * THE PARENTHESES ARE ESCAPED, and they have to be. fast-glob (micromatch)
 * reads an unescaped `(kiosk)` as an EXTGLOB GROUP, so the pattern
 * "app/(kiosk)/**" matches exactly nothing — and a glob that matches nothing
 * makes every it.each below vanish and every rule above pass vacuously. This
 * suite reported green while scanning none of the kiosk routes until the
 * tripwire test caught it. Route groups have now bitten the eslint baseline,
 * the dependency-cruiser carve-out and this file; assume any config holding a
 * path needs the same treatment.
 */
const KIOSK_FILES = fg
  .sync(["app/\\(kiosk\\)/**/*.{ts,tsx}", "components/kiosk-*.tsx", "lib/kiosk/**/*.ts"], {
    cwd: SRC,
    absolute: true,
  })
  .sort();

const rel = (f: string) => path.relative(process.cwd(), f);

/**
 * Strip // line and block comments so the prose in these files — which
 * necessarily describes the very patterns it forbids — is not scanned as code.
 * Same self-trip hazard tests/unit/a11y-static-invariants.test.ts documents.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

describe("kiosk lockdown — the kiosk tree exists and is being scanned", () => {
  it("finds the kiosk files (tripwire: an empty glob passes every rule below)", () => {
    // This assertion is not decoration — it is the only thing standing between
    // a mis-escaped glob and a suite that reports green having scanned nothing.
    expect(KIOSK_FILES.length).toBeGreaterThanOrEqual(14);
    expect(KIOSK_FILES.some((f) => f.includes("(kiosk)"))).toBe(true);
    expect(KIOSK_FILES.some((f) => f.endsWith("layout.tsx"))).toBe(true);
    // Every screen in the catalogue must be in the scan, or a screen could be
    // added with an external link in it and nothing would object.
    for (const screen of ["ferry", "eat", "events", "map", "parking", "stay", "do"]) {
      expect(
        KIOSK_FILES.some((f) => f.includes(`/kiosk/${screen}/page.tsx`)),
        `no kiosk screen file scanned for "${screen}"`,
      ).toBe(true);
    }
  });
});

describe("kiosk lockdown — no way off the app", () => {
  it.each(KIOSK_FILES.map((f) => [rel(f), f] as const))(
    "%s renders no absolute-URL anchor",
    (_name, file) => {
      const src = code(readFileSync(file, "utf8"));
      // href to any scheme, or a protocol-relative //host — the shapes that
      // navigate a browser off-origin. Internal <Link href="/kiosk/..."> and
      // the QR components' `value` props are untouched by this.
      const hits = [...src.matchAll(/href\s*=\s*[{"']\s*["'`]?(https?:|\/\/|mailto:|tel:)/g)].map(
        (m) => m[0],
      );
      expect(hits, `external href(s) in ${rel(file)}: ${hits.join(", ")}`).toEqual([]);
    },
  );

  it.each(KIOSK_FILES.map((f) => [rel(f), f] as const))(
    "%s opens no new browsing context",
    (_name, file) => {
      const src = code(readFileSync(file, "utf8"));
      // target="_blank" on a kiosk either does nothing or spawns a window the
      // visitor cannot close — both are failures.
      expect(src, `${rel(file)} uses target=_blank`).not.toMatch(/target\s*=\s*[{"']\s*_blank/);
    },
  );

  it.each(KIOSK_FILES.map((f) => [rel(f), f] as const))(
    "%s embeds no third-party frame or script",
    (_name, file) => {
      const src = code(readFileSync(file, "utf8"));
      expect(src, `${rel(file)} renders an iframe`).not.toMatch(/<iframe/i);
      // An external <script src> would also breach the kiosk's CSP
      // self-containment rule (no CDN, ever).
      expect(src, `${rel(file)} loads an external script`).not.toMatch(
        /<script[^>]+src\s*=\s*[{"']\s*["'`]?(https?:|\/\/)/i,
      );
    },
  );

  it("never imports the site's outbound-link components", () => {
    // ExternalLink / OutboundLink exist precisely to render an <a target=_blank>
    // and beacon the tap. Importing either into the kiosk tree is the most
    // likely way this rule gets broken, and it would sail past the href greps
    // above because the anchor is written in ui.tsx, not here.
    for (const file of KIOSK_FILES) {
      const src = code(readFileSync(file, "utf8"));
      expect(src, `${rel(file)} imports ExternalLink`).not.toMatch(/\bExternalLink\b/);
      expect(src, `${rel(file)} imports OutboundLink`).not.toMatch(/\bOutboundLink\b/);
    }
  });

  it("never mounts the visitor Tracker on a kiosk route", () => {
    // A shared wall panel must not write to the visitor analytics series, and
    // its session id would never rotate — one "visitor" for the life of the
    // device. KioskShell sends its own source:"kiosk" beacon instead.
    for (const file of KIOSK_FILES) {
      const src = code(readFileSync(file, "utf8"));
      expect(src, `${rel(file)} mounts <Tracker/>`).not.toMatch(/<Tracker\b/);
    }
  });

  it("keeps the site chrome out of the kiosk group", () => {
    // SiteNav and SiteFooter are full of internal links that lead OUT of
    // /kiosk — the escape hatch does not have to be third-party to strand a
    // panel on a page with no way back.
    for (const file of KIOSK_FILES) {
      const src = code(readFileSync(file, "utf8"));
      expect(src, `${rel(file)} renders SiteNav`).not.toMatch(/<SiteNav\b/);
      expect(src, `${rel(file)} renders SiteFooter`).not.toMatch(/<SiteFooter\b/);
    }
  });
});

describe("kiosk lockdown — every QR destination is absolute", () => {
  it("hands the phone a full URL, never a site-relative path", () => {
    // A relative href encoded into a QR resolves against nothing on the
    // visitor's phone: the code scans, and the phone opens an error.
    const qr = readFileSync(path.join(SRC, "lib", "qr", "index.ts"), "utf8");
    expect(qr).toContain("absoluteUrl");
  });
});
