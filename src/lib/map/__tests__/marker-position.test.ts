import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// MapLibre places each marker with `.maplibregl-marker { position: absolute;
// top: 0; left: 0 }` plus a translate. A class on the marker element that sets
// `position` overrides that, so sized markers stack in normal flow: each pin is
// pushed down by the height of every pin before it. That fixed pixel error
// becomes a different ground distance at every zoom — pins "move" on zoom.
describe("map builder pin CSS", () => {
  it("never overrides the marker's absolute positioning", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(admin)/admin/maps/editor.tsx"), "utf8");
    const rule = src.match(/\.me-pin\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/position\s*:/);
  });
});
