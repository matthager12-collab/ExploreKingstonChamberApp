import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { lookupGeo, geoipStatus, __resetGeoipForTests } from "@/lib/geoip";
import { dataPath } from "@/lib/data-dir";

const mmdb = dataPath("geoip", "GeoLite2-City.mmdb");

beforeEach(() => {
  // A dev machine that exports a real key must not turn these into live
  // downloads — the self-heal only fires when a key is present.
  delete process.env.MAXMIND_LICENSE_KEY;
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
    expect(s.edition).toBe("GeoLite2-City");
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
