// Chamber-member pin emphasis (MapFeature.member).
//
// Two failure modes worth a guard, neither of which a component test catches:
//
// 1. THE SILENT DROP. `src/app/api/admin/map-features/route.ts` rebuilds each
//    feature from known fields only — its own comment records that `cost` was
//    lost this way the first time an admin saved. A field must be BOTH parsed
//    off the body AND spread into the rebuilt object, and the editor must send
//    it. Miss any one and membership vanishes on the admin's first save, with
//    no error anywhere.
// 2. RING CONTRAST. The member ring is a graphical object under WCAG 1.4.11,
//    so it needs 3:1 against whatever it sits on — and what it sits on is the
//    basemap, which ADR-0007 changes. The brand's logo cyan (#1E96C0) does NOT
//    clear this; tide-deep does. Computed here rather than asserted as a
//    literal so re-tinting the basemap fails loudly instead of silently.
//
// Grep-style guards, scoped to src/, in the manner of the other tests/ scans.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), "utf8");

const ROUTE = read("src/app/api/admin/map-features/route.ts");
const EDITOR = read("src/app/(site)/admin/maps/editor.tsx");
const MAP = read("src/components/feature-map.tsx");
const TYPES = read("src/lib/map/types.ts");

// --- WCAG relative luminance / contrast -------------------------------------
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (h: string) => {
  const [r, g, b] = hex(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Every base surface a member pin can land on. Markers sit on land and
 * buildings in practice, but a waterfront feature can overhang the water, and
 * the pin body itself is white.
 *
 * KEEP IN SYNC with `mapStyle()` in src/lib/map/basemap.ts (ADR-0007). If the
 * basemap palette moves and this list doesn't, this test is measuring a map
 * that no longer exists.
 */
const BASE_SURFACES: Record<string, string> = {
  "pin body (white)": "#ffffff",
  "land / earth": "#e4e8e4",
  buildings: "#d8ddd7",
  forest: "#b3cbad",
  greenspace: "#aac4a4",
  water: "#b5d2de",
};

describe("MapFeature.member — the field survives a round trip", () => {
  it("is declared on the type as an optional boolean", () => {
    expect(TYPES).toMatch(/member\?: boolean;/);
  });

  it("is parsed off the request body in the admin API route", () => {
    expect(ROUTE).toMatch(/const member = body\.member === true \? true : undefined;/);
  });

  it("is spread back into the rebuilt feature — the silent-drop guard", () => {
    // The route rebuilds from known fields only; parsing alone is not enough.
    expect(ROUTE).toMatch(/\.\.\.\(member \? \{ member \} : \{\}\)/);
  });

  it("is sent by the admin editor's save payload", () => {
    expect(EDITOR).toMatch(/kind === "marker" && draft\.member \? \{ member: true \} : \{\}/);
  });

  it("has an admin control, so it is settable without hand-editing JSON", () => {
    expect(EDITOR).toMatch(/patchDraft\(\{ member: e\.target\.checked \}\)/);
    expect(EDITOR).toContain("Chamber member");
  });
});

describe("member pin emphasis is not carried by colour alone", () => {
  it("also changes pin size (WCAG 1.4.1 — a second channel)", () => {
    expect(MAP).toMatch(/const size = member \? 34 : 30;/);
  });

  it("states membership in words in the popup", () => {
    expect(MAP).toContain(">Chamber member<");
  });

  it("does not de-emphasise non-members anywhere", () => {
    // Emphasis is additive by decision (see the MapFeature.member docblock).
    // A rule keyed on NOT being a member would be the regression.
    expect(MAP).not.toMatch(/!member.*opacity|opacity.*!member/);
  });
});

describe("member ring clears WCAG 1.4.11 on every basemap surface", () => {
  const ring = MAP.match(/const MEMBER_RING = "(#[0-9a-fA-F]{6})"/)?.[1];

  it("is defined as a single named constant", () => {
    expect(ring).toBeTruthy();
  });

  for (const [name, surface] of Object.entries(BASE_SURFACES)) {
    it(`is >= 3:1 against ${name}`, () => {
      expect(contrast(ring!, surface)).toBeGreaterThanOrEqual(3);
    });
  }

  it("rejects both brand cyan tokens, which is why a derived shade is used", () => {
    // Regression guard. Both are tempting "just use the token" edits, and both
    // fail — on different surfaces, which is why the loop above checks all of
    // them rather than a single representative fill.
    expect(contrast("#1E96C0", BASE_SURFACES.water)).toBeLessThan(3); // --color-tide
    expect(contrast("#16758f", BASE_SURFACES.greenspace)).toBeLessThan(3); // --color-tide-deep
  });
});
