// The kiosk screen catalogue must match what is actually on disk (E22).
//
// The kiosk renders a tile per enabled screen and has NO BROWSER CHROME: no
// back button, no address bar, no way for a visitor to recover from a tile that
// leads to a 404 except to wait out the idle timer or find a member of staff.
// A dead tile is therefore a materially worse bug here than a dead link on the
// website, and it is the kind that appears when someone adds a catalogue entry
// intending to write the page "next".

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENABLED_SCREENS,
  enabledScreensInOrder,
  isKioskScreenId,
  KIOSK_SCREEN_IDS,
  KIOSK_SCREENS,
} from "@/lib/kiosk/screens";
import { candidatePageFiles, resolvesToPage } from "../helpers/app-routes";

describe("kiosk screen catalogue ↔ routes", () => {
  it.each(KIOSK_SCREENS.map((s) => [s.id, s] as const))(
    "%s resolves to a real page.tsx",
    (id) => {
      const route = `/kiosk/${id}`;
      expect(
        resolvesToPage(route),
        `${route} matched no page.tsx — looked in:\n  ${candidatePageFiles(route).join("\n  ")}`,
      ).toBe(true);
    },
  );

  it("the kiosk home screen itself exists", () => {
    expect(resolvesToPage("/kiosk")).toBe(true);
  });

  it("has unique ids and non-empty labels", () => {
    expect(new Set(KIOSK_SCREEN_IDS).size).toBe(KIOSK_SCREENS.length);
    for (const s of KIOSK_SCREENS) {
      expect(s.label.length, `${s.id} has no label`).toBeGreaterThan(0);
      expect(s.blurb.length, `${s.id} has no blurb`).toBeGreaterThan(0);
    }
  });
});

describe("kiosk defaults are usable out of the box", () => {
  it("defaults to real screens only", () => {
    for (const id of DEFAULT_ENABLED_SCREENS) {
      expect(isKioskScreenId(id), `${id} is not in the catalogue`).toBe(true);
    }
  });

  it("defaults to the ferry-rider core", () => {
    // docs/KIOSK.md §12: a walk-on passenger has 20-60 seconds and wants the
    // boat, food, and where things are.
    expect(DEFAULT_ENABLED_SCREENS).toContain("ferry");
    expect(DEFAULT_ENABLED_SCREENS).toContain("eat");
    expect(DEFAULT_ENABLED_SCREENS).toContain("map");
  });

  it("never defaults to an empty home screen", () => {
    expect(DEFAULT_ENABLED_SCREENS.length).toBeGreaterThan(0);
    expect(enabledScreensInOrder([...DEFAULT_ENABLED_SCREENS]).length).toBe(
      DEFAULT_ENABLED_SCREENS.length,
    );
  });

  it("shows tiles in catalogue order regardless of how they were saved", () => {
    // The admin checkbox list appends, so a stored list can be in any order.
    // Tile order is a layout decision, not a record of what someone clicked.
    const scrambled = ["parking", "ferry", "eat"];
    expect(enabledScreensInOrder(scrambled).map((s) => s.id)).toEqual(["ferry", "eat", "parking"]);
  });

  it("silently drops a screen id that no longer exists", () => {
    // Exactly what a restored backup from an older build looks like. It must
    // render the screens it still recognises, not a tile onto a 404.
    expect(enabledScreensInOrder(["ferry", "gone-screen"]).map((s) => s.id)).toEqual(["ferry"]);
    expect(isKioskScreenId("gone-screen")).toBe(false);
  });
});
