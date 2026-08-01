// E33 slice 3 — /line's selection logic: the open-now food filter and the
// amenity honesty split.
//
// The last describe pins the shipped SEED against the honest-empty-state
// contract: with today's sourced data nothing is walkable from the waiting
// stretch, so /line must lead with "we know of no restroom you can walk to".
// If a future seed adds a genuinely walkable amenity that failure is GOOD —
// it forces the empty-state copy decision to be made consciously (and
// answers the epic's Open question 2 with data instead of a guess).

import { describe, expect, it } from "vitest";
import { HOLDING_ROUTE, LINE_WEST_OF_DISPENSER } from "@/lib/ferry-line-geometry";
import {
  openFoodFromLine,
  splitAmenitiesFromLine,
  WALKABLE_FROM_LINE_MAX_MIN,
} from "@/lib/line-lander";
import { mapFeatures } from "@/lib/data/map-features";
import type { MapFeature } from "@/lib/map/types";
import type { Restaurant, WeeklyHours } from "@/lib/types";

/** Friday 2026-07-31, noon Pacific — a moment, not "now", so the open-now
 *  filter is deterministic under the suite's TZ=UTC. */
const NOON_PACIFIC = new Date("2026-07-31T12:00:00-07:00");

const ALL_DAY: WeeklyHours = {
  mon: [["08:00", "21:00"]],
  tue: [["08:00", "21:00"]],
  wed: [["08:00", "21:00"]],
  thu: [["08:00", "21:00"]],
  fri: [["08:00", "21:00"]],
  sat: [["08:00", "21:00"]],
  sun: [["08:00", "21:00"]],
};

const CLOSED_FRIDAY: WeeklyHours = { ...ALL_DAY, fri: [] };

function restaurant(id: string, over: Partial<Restaurant>): Restaurant {
  return {
    id,
    name: id,
    cuisine: "Test",
    description: "",
    address: "",
    priceLevel: 1,
    tags: [],
    lat: 47.7966,
    lng: -122.4958,
    walkMinutesFromFerry: 3,
    ...over,
  };
}

describe("openFoodFromLine", () => {
  const onLine = HOLDING_ROUTE[HOLDING_ROUTE.length - 2];
  const rows = openFoodFromLine(
    [
      restaurant("downtown-open", { weeklyHours: ALL_DAY, lat: 47.7965, lng: -122.4975 }),
      restaurant("roadside-open", { weeklyHours: ALL_DAY, lat: onLine[0], lng: onLine[1] }),
      restaurant("closed-today", { weeklyHours: CLOSED_FRIDAY }),
      restaurant("hidden-open", { weeklyHours: ALL_DAY, hidden: true }),
      restaurant("no-structured-hours", { hours: "11am–8pm daily" }),
    ],
    NOON_PACIFIC,
  );

  it("keeps only public places that are verifiably open right now", () => {
    expect(rows.map((r) => r.restaurant.id).sort()).toEqual(["downtown-open", "roadside-open"]);
  });

  it("sorts nearest-to-the-line first", () => {
    expect(rows.map((r) => r.restaurant.id)).toEqual(["roadside-open", "downtown-open"]);
    expect(rows[0].lineMeters).toBeLessThan(1);
    expect(rows[1].lineMeters).toBeGreaterThan(rows[0].lineMeters);
  });

  it("never emits a bare 0-minute walk", () => {
    for (const row of rows) expect(row.lineWalkMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe("splitAmenitiesFromLine", () => {
  const westVertex = LINE_WEST_OF_DISPENSER[1];
  const features: MapFeature[] = [
    {
      id: "restroom-on-line",
      kind: "marker",
      title: "Hypothetical roadside restroom",
      category: "restroom",
      views: ["amenities"],
      point: [westVertex[0], westVertex[1]],
    },
    {
      id: "restroom-dock",
      kind: "marker",
      title: "Dock restroom",
      category: "restroom",
      views: ["amenities"],
      point: [47.7962, -122.498],
    },
    {
      id: "bench-on-line",
      kind: "marker",
      title: "Bench",
      category: "bench",
      views: ["amenities"],
      point: [westVertex[0], westVertex[1]],
    },
    {
      id: "trail-not-a-marker",
      kind: "trail",
      title: "Trail",
      category: "restroom",
      views: ["amenities"],
      path: [
        [47.79, -122.5],
        [47.8, -122.5],
      ],
    },
  ];
  const split = splitAmenitiesFromLine(features);

  it("puts a restroom on the waiting stretch in `walkable`", () => {
    expect(split.walkable.map((r) => r.feature.id)).toEqual(["restroom-on-line"]);
    expect(split.walkable[0].lineWalkMinutes).toBeLessThanOrEqual(WALKABLE_FROM_LINE_MAX_MIN);
  });

  it("puts the dock restroom in `atTerminal` — the terminal end must not flatter it", () => {
    expect(split.atTerminal.map((r) => r.feature.id)).toEqual(["restroom-dock"]);
    expect(split.atTerminal[0].lineWalkMinutes).toBeGreaterThan(WALKABLE_FROM_LINE_MAX_MIN);
  });

  it("ignores comfort amenities and non-marker geometry", () => {
    const ids = [...split.walkable, ...split.atTerminal].map((r) => r.feature.id);
    expect(ids).not.toContain("bench-on-line");
    expect(ids).not.toContain("trail-not-a-marker");
  });
});

describe("the shipped seed vs the honest empty state (Open question 2)", () => {
  it("maps NO amenity walkable from the waiting stretch — /line leads with the empty state", () => {
    const split = splitAmenitiesFromLine(mapFeatures);
    expect(
      split.walkable,
      "A seeded amenity now counts as walkable from the SR-104 waiting stretch. " +
        "If it is real and verified (M-19-03), update /line's amenities empty-state " +
        "copy and the LINE-LANDER doc; this is the epic's Open question 2 being answered.",
    ).toEqual([]);
    // Every sourced restroom from the tollbooths on. The portable toilet at the
    // booths belongs here rather than in `walkable`: it sits at the FRONT of the
    // line, so a driver parked west of the dispenser reaches it by moving up,
    // not by walking — which is exactly the distinction this split encodes.
    expect(split.atTerminal.map((r) => r.feature.id).sort()).toEqual([
      "restroom-boat-launch",
      "restroom-tollbooth-portable",
      "restroom-waterfront-promenade",
    ]);
  });
});
