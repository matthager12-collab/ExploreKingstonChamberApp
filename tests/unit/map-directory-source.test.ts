// The directory map source + hand-pin profile links (directory-public slice,
// phase 3), over PGlite: live-only, coordinates-only, category-filtered pins
// with the member fact derived from member_meta; and resolve-time profile
// links for custom markers whose title matches exactly one live listing —
// ambiguity and drafts must produce NO link.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { upsertMemberMeta } from "@/lib/db/member-meta";
import { resolveMapView } from "@/lib/map/resolve";
import { saveDirectoryListing } from "@/lib/stores/directory-store";
import { saveMapFeature, saveMapView } from "@/lib/stores/map-store";
import type { DirectoryListing } from "@/lib/types";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();

  const mk = (
    id: string,
    name: string,
    category: DirectoryListing["category"],
    extra: Partial<DirectoryListing> = {},
  ): DirectoryListing => ({
    id,
    name,
    category,
    description: "A test business with words enough for a blurb.",
    tags: [],
    ...extra,
  });

  // Live + placed, member.
  await saveDirectoryListing(mk("pin-shop", "Pin Shop", "shop", { lat: 47.8, lng: -122.5 }), {
    actor: "t",
    source: "admin",
    status: "live",
  });
  // Live + placed, non-member, different category.
  await saveDirectoryListing(
    mk("pin-salon", "Pin Salon", "services", { lat: 47.79, lng: -122.49 }),
    { actor: "t", source: "admin", status: "live" },
  );
  // Live but UNPLACED — never a pin.
  await saveDirectoryListing(mk("no-pin", "No Pin Yet", "shop"), {
    actor: "t",
    source: "admin",
    status: "live",
  });
  // DRAFT with coordinates — must not leak onto any map or link.
  await saveDirectoryListing(
    mk("draft-pin", "Draft Pin Co", "shop", { lat: 47.81, lng: -122.51 }),
    { actor: "t", source: "admin", status: "draft" },
  );
  // Two live listings sharing a name — ambiguity case for profile links.
  await saveDirectoryListing(mk("twin-a", "Twin Business", "shop"), {
    actor: "t",
    source: "admin",
    status: "live",
  });
  await saveDirectoryListing(mk("twin-b", "Twin Business", "services"), {
    actor: "t",
    source: "admin",
    status: "live",
  });

  await upsertMemberMeta([
    {
      subjectStore: "directory",
      subjectId: "pin-shop",
      memberStatus: "active",
      duesAmount: 375,
      source: "t",
      createdBy: "t",
    },
    // pin-salon: no meta row at all → non-member.
  ]);

  // A view carrying the directory source, category-narrowed to shops.
  await saveMapView(
    {
      id: "test-biz",
      name: "Test Businesses",
      center: [47.8, -122.5],
      zoom: 15,
      sources: ["directory"],
      directoryCategories: ["shop"],
      published: true,
    },
    { actor: "t" },
  );
  // A view with hand pins: one matching a live listing, one matching the
  // ambiguous pair, one matching a draft.
  await saveMapView(
    {
      id: "test-hand",
      name: "Test Hand Pins",
      center: [47.8, -122.5],
      zoom: 15,
      sources: [],
      published: true,
    },
    { actor: "t" },
  );
  const pin = (id: string, title: string) =>
    saveMapFeature(
      {
        id,
        kind: "marker" as const,
        title,
        views: ["test-hand"],
        point: [47.8, -122.5] as [number, number],
      },
      { actor: "t" },
    );
  await pin("hp-1", "Pin Shop");
  await pin("hp-2", "Twin Business");
  await pin("hp-3", "Draft Pin Co");
});
afterAll(async () => {
  await tdb.close();
});

describe("directory built-in source", () => {
  it("serves live, placed, category-matched listings with the member fact and profile path — nothing else", async () => {
    const resolved = await resolveMapView("test-biz");
    expect(resolved).not.toBeNull();
    const pins = resolved!.builtins.directory ?? [];
    expect(pins.map((p) => p.id)).toEqual(["pin-shop"]); // salon filtered by category, no-pin unplaced, draft-pin not live
    expect(pins[0]).toMatchObject({
      member: true,
      category: "shop",
      profilePath: "/directory/pin-shop",
    });
    // The wire payload carries the member FACT only — never a dues field.
    expect(JSON.stringify(pins[0])).not.toMatch(/dues/i);
  });

  it("serves all categories when directoryCategories is absent", async () => {
    await saveMapView(
      {
        id: "test-biz-all",
        name: "All",
        center: [47.8, -122.5],
        zoom: 15,
        sources: ["directory"],
        published: true,
      },
      { actor: "t" },
    );
    const resolved = await resolveMapView("test-biz-all");
    const ids = (resolved!.builtins.directory ?? []).map((p) => p.id).sort();
    expect(ids).toEqual(["pin-salon", "pin-shop"]);
    const salon = resolved!.builtins.directory!.find((p) => p.id === "pin-salon");
    expect(salon?.member).toBe(false);
  });
});

describe("hand-pin profile links", () => {
  it("links a marker to its matching live listing; ambiguous and draft matches get none", async () => {
    const resolved = await resolveMapView("test-hand");
    const links = resolved!.builtins.profileLinks ?? {};
    expect(links["hp-1"]).toBe("/directory/pin-shop");
    expect(links["hp-2"]).toBeUndefined(); // two live "Twin Business" rows — coin flips don't link
    expect(links["hp-3"]).toBeUndefined(); // draft listings never earn a public link
  });
});
