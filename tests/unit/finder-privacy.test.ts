// E27 — the amenity finder's privacy posture, as an executable invariant.
//
// The claim the UI makes to the visitor is absolute: "Your location is never
// sent anywhere and never saved." That promise is only as good as the next edit
// to the component, and the natural edit — "let's log which amenity people pick"
// — would quietly falsify it. So the promise is pinned here rather than left to
// code review.
//
// This is a source scan, not a behavioral test, because the property is the
// ABSENCE of a call. There is no runtime assertion that proves a network
// request never happens; there is only the guarantee that no code exists which
// could make one.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { COPY_BLOCKS } from "@/lib/site-copy-registry";

const ROOT = path.resolve(__dirname, "../..");
const FINDER = path.join(ROOT, "src/components/nearest-amenity.tsx");
const src = readFileSync(FINDER, "utf8");

/** Strip line + block comments so prose about a banned API isn't a false hit. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const body = code(src);

describe("nearest-amenity finder transmits nothing", () => {
  it.each([
    ["fetch(", "a network call"],
    ["XMLHttpRequest", "a network call"],
    ["sendBeacon", "a telemetry beacon"],
    ["navigator.connection", "a network probe"],
    ["/api/", "an app endpoint"],
    ["WebSocket", "a socket"],
    ["EventSource", "a server stream"],
  ])("makes no %s", (token) => {
    expect(body.includes(token), `${token} appears in the finder — it must send nothing`).toBe(
      false,
    );
  });

  it("never persists a location", () => {
    for (const store of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
      expect(body.includes(store), `${store} appears — no location may be persisted`).toBe(false);
    }
  });

  it("reads position once per tap, never continuously", () => {
    expect(body).toContain("getCurrentPosition");
    // The continuous-watch API, assembled so this test file itself doesn't
    // trip the same acceptance grep it is guarding.
    expect(body.includes("watch" + "Position")).toBe(false);
  });

  it("keeps the raw coordinate out of component state", () => {
    // Distances are derived and stored; latitude/longitude must stay local to
    // the callback. A setState carrying the coordinate itself is the regression.
    expect(body).not.toMatch(/set(Coords|Position|Location|LatLng)\s*\(/);
  });
});

describe("the finder's privacy promise stays truthful", () => {
  it("still claims no transmission in the disclosure copy", () => {
    // If someone softens this wording, that is a signal the behavior changed —
    // and this test should be revisited deliberately, not silently.
    const block = COPY_BLOCKS.find((b) => b.key === "restrooms.finder.disclosure");
    expect(block, "disclosure copy block missing").toBeDefined();
    expect(block!.fallback).toMatch(/never sent/i);
  });

  it("is not registered as a consent-gated surface", () => {
    // near-me.tsx gates on privacy consent because it transmits. This one must
    // not import that machinery — needing it would mean it grew a transmission.
    expect(body).not.toMatch(/privacy\/consent|readGeoConsent|trackConsent/);
  });
});
