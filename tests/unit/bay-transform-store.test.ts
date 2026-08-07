// The bay-nudge store and its path onto the map (E33).
//
// The point of these tests is the seam, not the maths — transformPosition() is
// covered in src/lib/map/__tests__/bay-transform.test.ts. What is asserted here
// is that a nudge survives the round trip through Postgres, that the store
// re-clamps on the way out, and that resolveMapView() actually carries it to
// the client for the parking view.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestDb, type TestDb } from "../setup/pglite-db";
import { BAY_TRANSFORM_LIMITS } from "@/lib/map/bay-transform";
import { getBayTransforms, saveBayTransform } from "@/lib/stores/bay-transform-store";
import { resolveMapView } from "@/lib/map/resolve";
import { saveMapView } from "@/lib/stores/map-store";
import type { MapView } from "@/lib/map/types";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

describe("bay-transform store", () => {
  it("round-trips a nudge, keyed by zone id", async () => {
    await saveBayTransform("port-pokhill", {
      dx: 4,
      dy: -2.5,
      rotateDeg: 3,
      scale: 1.05,
    });
    const all = await getBayTransforms();
    expect(all["port-pokhill"]).toEqual({
      dx: 4,
      dy: -2.5,
      rotateDeg: 3,
      scale: 1.05,
    });
  });

  it("overwrites the same zone in place rather than accumulating rows", async () => {
    await saveBayTransform("port-poktt", { dx: 1, dy: 1, rotateDeg: 0, scale: 1 });
    await saveBayTransform("port-poktt", { dx: 9, dy: 1, rotateDeg: 0, scale: 1 });
    const all = await getBayTransforms();
    expect(all["port-poktt"].dx).toBe(9);
  });

  it("clamps on write, so an out-of-range POST cannot reach the map", async () => {
    await saveBayTransform("port-pokpark-main-fan", {
      dx: 5000,
      dy: 0,
      rotateDeg: 0,
      scale: 1,
    });
    const all = await getBayTransforms();
    expect(all["port-pokpark-main-fan"].dx).toBe(BAY_TRANSFORM_LIMITS.offset);
  });

  // "Reset to generated" has to overwrite the previous record, so identity is
  // WRITTEN — but it carries no information, so it is dropped on read. Both
  // halves matter: without the write the old nudge returns, and without the
  // drop the client payload fills with no-ops.
  it("persists a reset but does not ship it to the client", async () => {
    await saveBayTransform("port-pokpark-89-103", { dx: 12, dy: 0, rotateDeg: 0, scale: 1 });
    expect((await getBayTransforms())["port-pokpark-89-103"]).toBeDefined();

    await saveBayTransform("port-pokpark-89-103", { dx: 0, dy: 0, rotateDeg: 0, scale: 1 });
    expect((await getBayTransforms())["port-pokpark-89-103"]).toBeUndefined();
  });
});

describe("a view that lists port-stalls carries the transforms to the client", () => {
  // parking-cash no longer lists the source (owner decision 2026-08-07), so
  // this builds a view that does — which is what /admin/maps produces when the
  // "Port parking bays" box is ticked. Asserting against parking-cash would
  // only re-test the seed's source list, and would go quiet the moment anyone
  // re-enabled the layer somewhere else.
  const VIEW: MapView = {
    id: "bay-test",
    name: "Bay test",
    center: [47.7972, -122.498],
    zoom: 17,
    sources: ["port-stalls"],
    published: false,
  };

  it("includes the saved nudges", async () => {
    await saveBayTransform("port-pokhill", { dx: 6, dy: 0, rotateDeg: 0, scale: 1 });
    await saveMapView(VIEW);
    const resolved = await resolveMapView("bay-test");
    expect(resolved).not.toBeNull();
    expect(resolved!.builtins.portStalls).toBeDefined();
    expect(resolved!.builtins.portStalls!.transforms["port-pokhill"].dx).toBe(6);
  });

  // The 84 KB of bay geometry must stay a static file the client fetches. If it
  // ever gets inlined here it rides on every view payload.
  it("does not inline the bay geometry itself", async () => {
    await saveMapView(VIEW);
    const resolved = await resolveMapView("bay-test");
    const keys = Object.keys(resolved!.builtins.portStalls!);
    expect(keys).toEqual(["transforms"]);
  });

  it("parking-cash does NOT list the source — the public map stays clean", async () => {
    const resolved = await resolveMapView("parking-cash");
    expect(resolved!.builtins.portStalls).toBeUndefined();
  });
});
