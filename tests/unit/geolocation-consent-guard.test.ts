// Static guard (E11 Never tier): device geolocation may only be read behind
// the affirmative-consent gate. The unit suite runs in node with no jsdom, so
// nothing can drive the components' click handlers — meaning a regression that
// deleted the gate from near-me.tsx or hunt-player.tsx would leave every other
// test green. This scan is the tripwire for that class of change, in the same
// idiom as no-fs-store-writes.test.ts.
//
// Rule: any non-test file under src/ that calls navigator.geolocation must
// also reference the consent module (src/lib/privacy/consent.ts). Files that
// are legitimately exempt are listed in ALLOWED with the reason — adding one
// is a deliberate, reviewable act, which is the point.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

/** Reading device position, in any of the shapes the codebase uses. */
const GEOLOCATION_RE = /navigator\.geolocation|getCurrentPosition|watchPosition/;
/** Evidence the file routes through the consent gate. */
const CONSENT_RE = /privacy\/consent|shouldPromptGeoConsent|hasGeoConsent/;

/**
 * Known, reviewed exemptions. `side-switcher.tsx` reads position on mount to
 * pick which side of the water the visitor is on; the reading is classified
 * client-side and written to a local preference cookie — it is never sent to
 * the server, so it collects nothing. It predates E11 and is a documented
 * product decision (docs/ARCHITECTURE.md decision 17, "ask location once
 * (opt-out)"). FLAGGED FOR REVIEW: E11's own standard is to ask in plain
 * language BEFORE the browser prompt, and this surface does not. Removing it
 * from this list (i.e. gating it) is the fix if that decision is revisited.
 *
 * `nearest-amenity.tsx` (E27) is the strongest exemption case here: the restroom
 * finder makes NO network call of any kind and persists nothing at all — not
 * even a preference cookie, so it collects strictly less than side-switcher
 * above. getCurrentPosition runs once per tap; the coordinate stays in a local
 * variable, only derived walking distances reach component state, and both die
 * with the page. There is nothing to consent to sharing, because nothing is
 * shared — the browser's own permission prompt is the whole gate, and adding a
 * second in-app prompt in front of an urgent "where is a restroom" tap would be
 * friction without a privacy gain. Enforced positively, not just by this
 * exemption: tests/unit/finder-privacy.test.ts fails if that file ever grows a
 * fetch, a beacon, a storage write, or a continuous position watch.
 */
const ALLOWED = new Set(["components/side-switcher.tsx", "components/nearest-amenity.tsx"]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

/** Strip line comments so prose about geolocation doesn't trip the scan. */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

describe("geolocation is only read behind the consent gate", () => {
  const offenders: string[] = [];
  const gated: string[] = [];

  for (const file of sourceFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
    const code = codeOnly(readFileSync(file, "utf8"));
    if (!GEOLOCATION_RE.test(code)) continue;
    if (ALLOWED.has(rel)) continue;
    if (CONSENT_RE.test(code)) gated.push(rel);
    else offenders.push(rel);
  }

  it("every geolocation caller references the consent gate", () => {
    expect(offenders, `ungated geolocation in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the two known consent surfaces are actually gated (guard is not vacuous)", () => {
    // If this fails, the scan found nothing to check — which would make the
    // assertion above pass for the wrong reason.
    expect(gated).toContain("components/near-me.tsx");
    expect(gated).toContain("components/hunt-player.tsx");
  });
});
