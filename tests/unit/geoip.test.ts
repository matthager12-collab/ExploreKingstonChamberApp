import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import {
  lookupGeo,
  geoipStatus,
  deriveCoarseGeo,
  GEOIP_DB_FILE,
  __resetGeoipForTests,
} from "@/lib/geoip";
import { dataPath } from "@/lib/data-dir";
import type { CityResponse } from "maxmind";

const mmdb = dataPath("geoip", GEOIP_DB_FILE);

beforeEach(() => {
  // Tests must resolve the dev fallback path, never a baked image path.
  delete process.env.GEOIP_DB_PATH;
  __resetGeoipForTests();
});
afterEach(async () => {
  __resetGeoipForTests();
  await rm(dataPath("geoip"), { recursive: true, force: true });
});

describe("geoip graceful absence (E10 AC#12)", () => {
  it("lookupGeo returns null (no throw) with no database present", () => {
    expect(() => lookupGeo("8.8.8.8")).not.toThrow();
    expect(lookupGeo("8.8.8.8")).toBeNull();
  });

  it("geoipStatus reports not-present when no file exists", async () => {
    const s = await geoipStatus();
    expect(s.present).toBe(false);
    expect(s.file).toBe(GEOIP_DB_FILE);
    expect(s.mtimeIso).toBeUndefined();
  });

  it("lookupGeo returns null (no throw) with a corrupt database file", async () => {
    await mkdir(dataPath("geoip"), { recursive: true });
    await writeFile(mmdb, "not a real mmdb");
    // Sync call: the reader loads in the background, and a corrupt file never
    // becomes a working reader, so lookups degrade to null and never throw.
    expect(() => lookupGeo("8.8.8.8")).not.toThrow();
    expect(lookupGeo("8.8.8.8")).toBeNull();
  });

  it("geoipStatus reports present with an mtime when a file exists", async () => {
    await mkdir(dataPath("geoip"), { recursive: true });
    await writeFile(mmdb, "placeholder");
    const s = await geoipStatus();
    expect(s.present).toBe(true);
    expect(typeof s.mtimeIso).toBe("string");
  });
});

// deriveCoarseGeo is the field adapter, tested against hand-built responses so
// the DB-IP-vs-GeoLite2 subdivision gap is covered WITHOUT a 125 MB fixture.
// Cast through unknown: real records carry many more fields than we read.
const asRes = (o: unknown) => o as CityResponse;

describe("deriveCoarseGeo — field compatibility", () => {
  it("DB-IP shape: region falls back to subdivisions[0].names.en (no iso_code)", () => {
    // This is the exact shape DB-IP City Lite returns for a US IP — the reason
    // this function exists. Reading iso_code alone would drop the state.
    const res = asRes({
      country: { iso_code: "US", names: { en: "United States" } },
      subdivisions: [{ names: { en: "Washington" } }],
      city: { names: { en: "Seattle (Northeast Seattle)" } },
    });
    expect(deriveCoarseGeo(res)).toEqual({
      country: "US",
      region: "Washington",
      city: "Seattle", // trailing "(Northeast Seattle)" stripped
    });
  });

  it("GeoLite2 shape: region prefers subdivisions[0].iso_code when present", () => {
    const res = asRes({
      country: { iso_code: "US", names: { en: "United States" } },
      subdivisions: [{ iso_code: "WA", names: { en: "Washington" } }],
      city: { names: { en: "Seattle" } },
    });
    expect(deriveCoarseGeo(res)).toEqual({ country: "US", region: "WA", city: "Seattle" });
  });

  it("keeps a bare city name unchanged (no parenthetical to strip)", () => {
    const res = asRes({ city: { names: { en: "Poulsbo" } } });
    expect(deriveCoarseGeo(res)).toEqual({ city: "Poulsbo" });
  });

  it("returns null for a null response and for a response with no usable fields", () => {
    expect(deriveCoarseGeo(null)).toBeNull();
    expect(deriveCoarseGeo(asRes({}))).toBeNull();
    // A city that is ONLY a parenthetical strips to empty → not a usable field.
    expect(deriveCoarseGeo(asRes({ city: { names: { en: "(unknown)" } } }))).toBeNull();
  });

  it("country-only response (e.g. an IP with no city record) still resolves", () => {
    const res = asRes({ country: { iso_code: "CA", names: { en: "Canada" } } });
    expect(deriveCoarseGeo(res)).toEqual({ country: "CA" });
  });
});
