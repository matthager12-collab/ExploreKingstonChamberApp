// A street zone DRAWN in the editor must survive saving — twice.
//
// admin-parking-curb.test.ts already covers a SEED street zone. That case has a
// safety net this one does not: parking-store's withSeedStreetGeometry() merges
// the seed's paths back into any overlay record missing them, so a whitelist
// omission there is invisible. A street drawn by hand has no seed row, so the
// same omission destroys the line permanently on the first save.
//
// That asymmetry is why this suite exists separately, and why it saves each
// zone TWICE: the second save is the one that would silently drop geometry a
// first save appeared to accept.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";
import { signInAdmin } from "./admin-session";

type Zone = {
  id: string;
  name: string;
  rule: string;
  center: [number, number];
  streetPaths?: [number, number][][];
  curb?: string;
  polygon?: [number, number][];
};

// Kingston, inside the API's greater-Kingston bbox. Two disjoint stretches, the
// shape the seed's `street-central-ave` and `street-washington-blvd` have.
const PATH_A: [number, number][] = [
  [47.79651, -122.49752],
  [47.79683, -122.49551],
  [47.79694, -122.49402],
];
const PATH_B: [number, number][] = [
  [47.79801, -122.49903],
  [47.79842, -122.49721],
];

let browser: Browser;
let context: BrowserContext;
let page: Page;
const created: string[] = [];

async function getZone(id: string): Promise<Zone | undefined> {
  const zones = (await page.evaluate(async () => {
    const res = await fetch("/api/admin/parking");
    if (!res.ok) throw new Error(`GET /api/admin/parking -> ${res.status}`);
    return (await res.json()).zones;
  })) as Zone[];
  return zones.find((z) => z.id === id);
}

async function postZone(zone: unknown): Promise<number> {
  return await page.evaluate(async (z) => {
    const res = await fetch("/api/admin/parking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(z),
    });
    return res.status;
  }, zone as Record<string, unknown>);
}

/** What the editor POSTs for a freshly drawn street line. */
function drawnStreet(id: string, paths: [number, number][][]): Zone {
  created.push(id);
  return {
    id,
    name: "Drawn street",
    rule: "free-2hr",
    center: paths[0][Math.floor(paths[0].length / 2)],
    streetPaths: paths,
  } as Zone;
}

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
  await signInAdmin(context);
  page = await context.newPage();
  await page.goto(BASE_URL + "/admin", { waitUntil: "domcontentloaded" });
});

afterAll(async () => {
  for (const id of created) {
    await page
      .evaluate(
        (i) => fetch(`/api/admin/parking?id=${encodeURIComponent(i)}`, { method: "DELETE" }),
        id,
      )
      .catch(() => {});
  }
  await browser?.close();
});

describe("a street zone drawn in the editor", () => {
  it("saves and reads back its line byte-identically", async () => {
    const zone = drawnStreet("street-drawn-single", [PATH_A]);
    expect(
      await postZone({ ...zone, summary: "s", details: "d", confidence: "probable", overnight: "confirm-first" }),
    ).toBe(200);
    const saved = await getZone(zone.id);
    expect(saved?.streetPaths).toEqual([PATH_A]);
    // Not a polygon: the public map branches on this, and a stray polygon would
    // render the street as a filled blob.
    expect(saved?.polygon).toBeUndefined();
  });

  it("KEEPS the line through a second, unrelated save (no seed to rescue it)", async () => {
    const zone = drawnStreet("street-drawn-resave", [PATH_A]);
    expect(
      await postZone({ ...zone, summary: "s", details: "d", confidence: "probable", overnight: "confirm-first" }),
    ).toBe(200);
    const first = await getZone(zone.id);
    expect(first?.streetPaths).toEqual([PATH_A]);

    // The editor's ordinary save after renaming: the zone as read, posted back.
    expect(await postZone({ ...first, name: "Renamed" })).toBe(200);
    const second = await getZone(zone.id);
    expect(second?.name).toBe("Renamed");
    expect(second?.streetPaths, "the drawn line must not be wiped").toEqual([PATH_A]);
  });

  it("round-trips MULTIPLE paths in order — the multi-stretch case", async () => {
    const zone = drawnStreet("street-drawn-multi", [PATH_A, PATH_B]);
    expect(
      await postZone({ ...zone, summary: "s", details: "d", confidence: "probable", overnight: "confirm-first" }),
    ).toBe(200);
    const saved = await getZone(zone.id);
    expect(saved?.streetPaths).toEqual([PATH_A, PATH_B]);

    // And a re-save keeps BOTH — the failure mode where only the edited path
    // is written back and the other silently disappears.
    expect(await postZone(saved)).toBe(200);
    expect((await getZone(zone.id))?.streetPaths).toEqual([PATH_A, PATH_B]);
  });

  it("accepts a curb side on a drawn street, and clearing it persists", async () => {
    const zone = drawnStreet("street-drawn-curb", [PATH_A]);
    expect(
      await postZone({
        ...zone,
        summary: "s",
        details: "d",
        confidence: "probable",
        overnight: "confirm-first",
        curb: "east",
      }),
    ).toBe(200);
    expect((await getZone(zone.id))?.curb).toBe("east");

    const withCurb = await getZone(zone.id);
    const { curb: _cleared, ...cleared } = withCurb!;
    expect(await postZone(cleared)).toBe(200);
    const after = await getZone(zone.id);
    expect(after?.curb).toBeUndefined();
    expect(after?.streetPaths).toEqual([PATH_A]); // geometry untouched by that
  });

  it("rejects a one-point line — a click, not a street", async () => {
    const zone = drawnStreet("street-drawn-degenerate", [[PATH_A[0]]]);
    expect(
      await postZone({ ...zone, summary: "", details: "", confidence: "probable", overnight: "confirm-first" }),
    ).toBe(400);
    expect(await getZone(zone.id)).toBeUndefined();
  });

  it("rejects a line dragged outside the Kingston bbox", async () => {
    const zone = drawnStreet("street-drawn-offmap", [
      [
        [47.79651, -122.49752],
        [40.0, -100.0],
      ],
    ]);
    expect(
      await postZone({ ...zone, summary: "", details: "", confidence: "probable", overnight: "confirm-first" }),
    ).toBe(400);
    expect(await getZone(zone.id)).toBeUndefined();
  });
});
