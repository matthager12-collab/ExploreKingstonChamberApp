import { describe, expect, it } from "vitest";
import { abbreviateStreetName } from "@/lib/map/street-abbrev";

// Mechanical USPS abbreviation (owner request 2026-08-01). Every expectation
// here is a real name from the served Kingston tiles unless marked synthetic.
describe("abbreviateStreetName", () => {
  it("applies USPS Publication 28 suffix + directional forms", () => {
    expect(abbreviateStreetName("Northeast State Highway 104")).toBe("NE State Hwy 104");
    expect(abbreviateStreetName("Northeast West Kingston Road")).toBe("NE West Kingston Rd");
    expect(abbreviateStreetName("100th Avenue West")).toBe("100th Ave W");
    expect(abbreviateStreetName("North 175th Street")).toBe("N 175th St");
    expect(abbreviateStreetName("Pacific Highway")).toBe("Pacific Hwy");
    expect(abbreviateStreetName("10th Terrace Northwest")).toBe("10th Ter NW");
    expect(abbreviateStreetName("State Highway 3 Northwest")).toBe("State Hwy 3 NW");
    // Synthetic coverage for the remaining suffix forms in the owner's list.
    expect(abbreviateStreetName("Ferncliff Boulevard")).toBe("Ferncliff Blvd");
    expect(abbreviateStreetName("Madrona Court Northeast")).toBe("Madrona Ct NE");
    expect(abbreviateStreetName("Salish Circle")).toBe("Salish Cir");
    expect(abbreviateStreetName("Heron Lane")).toBe("Heron Ln");
    expect(abbreviateStreetName("Osprey Drive Southeast")).toBe("Osprey Dr SE");
    expect(abbreviateStreetName("Chico Place")).toBe("Chico Pl");
  });

  it("abbreviates ONLY — never renames: 'SR 104' would drop words, so Highway stays a word swap", () => {
    // The abbreviation of "Northeast State Highway 104" keeps all four words.
    expect(abbreviateStreetName("Northeast State Highway 104")).not.toContain("SR");
    expect(abbreviateStreetName("Northeast State Highway 104").split(" ")).toHaveLength(4);
    // "Route" has no USPS form; shortening it would drift toward a rename.
    expect(abbreviateStreetName("State Route 104")).toBe("State Route 104");
    expect(abbreviateStreetName("State Route 104 Northeast")).toBe("State Route 104 NE");
  });

  it("keeps a leading directional when the name ALSO ends in one (it is the place name, not a grid prefix)", () => {
    // The road to South Kingston — county signage says "South Kingston Rd NE".
    expect(abbreviateStreetName("South Kingston Road Northeast")).toBe("South Kingston Rd NE");
    // Synthetic: the guard also engages on an already-short post-directional
    // (leading West survives; the suffix still abbreviates independently).
    expect(abbreviateStreetName("West Kingston Road NE")).toBe("West Kingston Rd NE");
  });

  it("never touches a directional mid-name (the 'West' in West Kingston)", () => {
    expect(abbreviateStreetName("Northeast West Kingston Road")).toBe("NE West Kingston Rd");
  });

  it("abbreviates only the final suffix slot — interior suffix words are part of the name", () => {
    expect(abbreviateStreetName("Arbors Terrace Rd NE")).toBe("Arbors Terrace Rd NE");
    // Synthetic: "Highway Place" — Highway is the name here, Place the suffix.
    expect(abbreviateStreetName("Highway Place")).toBe("Highway Pl");
  });

  it("is case-insensitive on input, canonical on output (OSM has one lowercase directional)", () => {
    expect(abbreviateStreetName("Fern Gully Place northeast")).toBe("Fern Gully Pl NE");
  });

  it("is idempotent: pre-abbreviated OSM names pass through byte-identical", () => {
    for (const already of ["Arborwood Dr NE", "Marinwood Cir NE", "N 175th St"]) {
      expect(abbreviateStreetName(already)).toBe(already);
    }
    expect(abbreviateStreetName(abbreviateStreetName("Northeast State Highway 104"))).toBe(
      "NE State Hwy 104",
    );
  });

  it("leaves recreational and unmapped names alone (Trail/Way/Loop stay words; single tokens untouched)", () => {
    for (const name of [
      "Carpenter Lake Trail",
      "Barber Cut Off Road", // suffix slot is Road; Off/Cut untouched
      "Kingsview Loop Northeast",
      "Shortcut",
      "Salal",
    ]) {
      const out = abbreviateStreetName(name);
      // Only expected transforms: Road->Rd + trailing directional.
      expect(out).toBe(
        name
          .replace(/ Road$/, " Rd")
          .replace(/ Northeast$/, " NE"),
      );
    }
    // A bare suffix word can never abbreviate itself away.
    expect(abbreviateStreetName("Circle")).toBe("Circle");
  });
});
