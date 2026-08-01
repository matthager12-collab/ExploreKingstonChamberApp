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

  it("is sent by the admin editor's save payload — for markers AND areas", () => {
    // The editor rebuilds its payload from the form draft, so a stale kind
    // gate here is the strip trap: the API would accept `member` on an area,
    // but the editor would never send it and the flag dies on first save.
    expect(EDITOR).toMatch(
      /\(kind === "marker" \|\| kind === "area"\) && draft\.member \? \{ member: true \} : \{\}/,
    );
  });

  it("has an admin control, so it is settable without hand-editing JSON", () => {
    expect(EDITOR).toMatch(/patchDraft\(\{ member: e\.target\.checked \}\)/);
    expect(EDITOR).toContain("Chamber member");
  });

  it("offers the control on area features too, with area-specific wording", () => {
    // The checkbox block is gated on marker-or-area, and explains the area
    // treatment in its own words (the marker copy talks about pins).
    expect(EDITOR).toMatch(/\(draft\.kind === "marker" \|\| draft\.kind === "area"\) && \(\s*<label/);
    expect(EDITOR).toContain("Tints the footprint member-blue");
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

  it("also styles the matched member building, from the same constant", () => {
    // One colour for both member tiers — pin ring and building highlight.
    expect(MAP).toMatch(/"fill-color": MEMBER_RING/);
    expect(MAP).toMatch(/"line-color": MEMBER_RING/);
  });

  it("rejects both brand cyan tokens, which is why a derived shade is used", () => {
    // Regression guard. Both are tempting "just use the token" edits, and both
    // fail — on different surfaces, which is why the loop above checks all of
    // them rather than a single representative fill.
    expect(contrast("#1E96C0", BASE_SURFACES.water)).toBeLessThan(3); // --color-tide
    expect(contrast("#16758f", BASE_SURFACES.greenspace)).toBeLessThan(3); // --color-tide-deep
  });
});

describe('"member built" — the highlighted building cannot read as water', () => {
  const ring = MAP.match(/const MEMBER_RING = "(#[0-9a-fA-F]{6})"/)?.[1] ?? "";
  const opacity = Number(MAP.match(/const MEMBER_BUILDING_OPACITY = ([\d.]+);/)?.[1]);

  /** src-over composite of the translucent highlight on the plain building. */
  const composite = (fg: string, a: number, bg: string) => {
    const [f, b] = [hex(fg), hex(bg)];
    return (
      "#" +
      [0, 1, 2]
        .map((i) => Math.round(a * f[i] + (1 - a) * b[i]).toString(16).padStart(2, "0"))
        .join("")
    );
  };
  const lstar = (h: string) => {
    const y = lum(h);
    return y <= 216 / 24389 ? (y * 24389) / 27 : Math.cbrt(y) * 116 - 16;
  };

  it("declares the opacity as a named constant", () => {
    expect(opacity).toBeGreaterThan(0);
  });

  it("stays clear of the water fill in lightness", () => {
    // THE failure mode: a translucent blue building at too low an opacity
    // lands on the water's lightness and reads as a pond. 8 L* is the floor.
    const fill = composite(ring, opacity, BASE_SURFACES.buildings);
    expect(Math.abs(lstar(fill) - lstar(BASE_SURFACES.water))).toBeGreaterThanOrEqual(8);
  });

  it("is still distinguishable from a plain neighbouring building", () => {
    const fill = composite(ring, opacity, BASE_SURFACES.buildings);
    expect(contrast(fill, BASE_SURFACES.buildings)).toBeGreaterThanOrEqual(1.35);
  });

  it("keeps its own outline visible on top of it", () => {
    const fill = composite(ring, opacity, BASE_SURFACES.buildings);
    expect(contrast(ring, fill)).toBeGreaterThanOrEqual(3);
  });
});

describe("member AREA treatment — a drawn footprint clears every basemap surface", () => {
  // The drawn-area analogue of the two "member built" describes above, per the
  // same methodology: recompute the src-over composite of the translucent
  // member fill on each base surface and hold it to the same floors. A drawn
  // area differs from the runtime-matched building in one load-bearing way: it
  // can sit on ANY base surface (a footprint traced over plain land, a lawn,
  // even a pier over water), not just the neutral building grey — so every
  // check here runs per surface, not once.
  const ring = MAP.match(/const MEMBER_RING = "(#[0-9a-fA-F]{6})"/)?.[1] ?? "";
  const opacity = Number(MAP.match(/const MEMBER_AREA_OPACITY = ([\d.]+);/)?.[1]);

  /** Base surfaces a DRAWN area can actually sit on (the white pin body is a
   *  pin-ring concern, not a ground surface). */
  const AREA_SURFACES = Object.fromEntries(
    Object.entries(BASE_SURFACES).filter(([name]) => name !== "pin body (white)"),
  );

  const composite = (fg: string, a: number, bg: string) => {
    const [f, b] = [hex(fg), hex(bg)];
    return (
      "#" +
      [0, 1, 2]
        .map((i) => Math.round(a * f[i] + (1 - a) * b[i]).toString(16).padStart(2, "0"))
        .join("")
    );
  };
  const lstar = (h: string) => {
    const y = lum(h);
    return y <= 216 / 24389 ? (y * 24389) / 27 : Math.cbrt(y) * 116 - 16;
  };

  it("declares its own opacity constant, separate from the matched-building one", () => {
    // 0.32 (the matched-building value) over plain land composites only
    // 7.4 L* from the water fill — under the 8 L* pond floor. The drawn-area
    // treatment therefore carries its own, deeper constant.
    expect(opacity).toBeGreaterThan(0);
  });

  it("renders fill AND boundary from the member family (fm-member-areas layers)", () => {
    expect(MAP).toMatch(/id: "fm-member-areas",\s*type: "fill"/);
    expect(MAP).toMatch(/"fill-opacity": \["get", "tint"\]/);
    expect(MAP).toMatch(/id: "fm-member-areas-ring",\s*type: "line"/);
    expect(MAP).toMatch(/"line-width": \["get", "ring"\]/);
    // Both the matched-building layers and the drawn-area layers draw from the
    // single MEMBER_RING constant — one colour for every member tier.
    expect((MAP.match(/"fill-color": MEMBER_RING/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((MAP.match(/"line-color": MEMBER_RING/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps an own-colour area's colour: casing + white gap, never a repaint", () => {
    // #140's channel rule, areas edition: when the area carries its own
    // category colour (parking type / manual), that colour keeps the fill and
    // outline; membership adds a concentric member-blue casing under it with
    // a white separating gap — the pin's ring/gap/ring structure.
    expect(MAP).toMatch(/tint: 0, ring: 9, casing: 1/);
    expect(MAP).toMatch(/id: "fm-member-areas-gap"/);
    expect(MAP).toMatch(/filter: \["==", \["get", "casing"\], 1\]/);
  });

  for (const [name, surface] of Object.entries(AREA_SURFACES)) {
    const fill = () => composite(ring, opacity, surface);

    it(`boundary is >= 3:1 against ${name} (WCAG 1.4.11 — the binding floor)`, () => {
      expect(contrast(ring, surface)).toBeGreaterThanOrEqual(3);
    });

    it(`fill is distinguishable from plain ${name}`, () => {
      expect(contrast(fill(), surface)).toBeGreaterThanOrEqual(1.35);
    });

    it(`boundary stays visible on its own fill over ${name}`, () => {
      // The INNER edge. Not the 1.4.11 check — that is boundary-vs-surface
      // above (the boundary's job is delimiting the footprint from the base;
      // the fill inside is the same hue family by design, exactly like the
      // member pin's blue-on-blue). 2:1 is the visibility floor: below it the
      // outline genuinely melts into the tint on the deep greens.
      expect(contrast(ring, fill())).toBeGreaterThanOrEqual(2);
    });
  }

  for (const [name, surface] of Object.entries(AREA_SURFACES)) {
    if (name === "water") continue; // over water the 1.35:1 check above governs
    it(`fill over ${name} cannot read as water (>= 8 L* clear)`, () => {
      const fill = composite(ring, opacity, surface);
      expect(Math.abs(lstar(fill) - lstar(BASE_SURFACES.water))).toBeGreaterThanOrEqual(8);
    });
  }
});

describe('"member built" degrades quietly when there is no footprint', () => {
  it("guards on the basemap buildings layer existing", () => {
    expect(MAP).toMatch(/memberPts\.length && map\.getLayer\("buildings"\)/);
  });

  it("draws under roads, not over them", () => {
    expect(MAP).toMatch(/map\.getLayer\("roads"\) \? "roads" : undefined/);
  });

  it("re-runs as tiles come into view, since queries only see rendered tiles", () => {
    expect(MAP).toMatch(/map\.on\("idle", syncMemberBuildings\)/);
  });

  it("skips off-screen points rather than querying blind", () => {
    expect(MAP).toMatch(/p\.x < 0 \|\| p\.y < 0 \|\| p\.x > width \|\| p\.y > height/);
  });
});
