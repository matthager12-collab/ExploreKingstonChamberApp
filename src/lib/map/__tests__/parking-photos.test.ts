import { describe, expect, it } from "vitest";
import {
  hasUndescribedPhoto,
  resolveParkingPhotoAlt,
  resolveParkingPhotos,
} from "@/lib/map/parking-photos";
import type { MediaItem } from "@/lib/media/refs";

function item(over: Partial<MediaItem> & { id: string }): MediaItem {
  return {
    title: "photo.jpg",
    alt: "",
    addedAt: "2026-08-03",
    bytes: 1024,
    ...over,
  };
}

const LIBRARY = new Map<string, MediaItem>([
  ["aaaaaaaa.jpg", item({ id: "aaaaaaaa.jpg", alt: "A pay station beside a row of angled stalls" })],
  ["bbbbbbbb.jpg", item({ id: "bbbbbbbb.jpg", alt: "", credit: "Jane Doe" })],
  ["cccccccc.jpg", item({ id: "cccccccc.jpg", alt: "The lot entrance from Washington Blvd" })],
]);

describe("resolveParkingPhotos", () => {
  it("resolves each name to the library proxy URL, preserving admin order", () => {
    const out = resolveParkingPhotos("Diamond lot D515", ["cccccccc.jpg", "aaaaaaaa.jpg"], LIBRARY);
    expect(out.map((p) => p.name)).toEqual(["cccccccc.jpg", "aaaaaaaa.jpg"]);
    // The path-segment shape, not ?p=<name>: next/image rejects a local src
    // with a query string, and mediaUrl() is the single place that decides it.
    expect(out[0].src).toBe("/api/media/cccccccc.jpg");
  });

  it("prefers the library's own description as alt text", () => {
    const [photo] = resolveParkingPhotos("Diamond lot D515", ["aaaaaaaa.jpg"], LIBRARY);
    expect(photo.alt).toBe("A pay station beside a row of angled stalls");
  });

  it("falls back to the zone name when the library item has no description", () => {
    // Pins the CURRENT policy (option b in resolveParkingPhotoAlt). If that
    // product decision changes, this expectation is the thing that should be
    // edited deliberately rather than a behaviour that drifts unnoticed.
    const [photo] = resolveParkingPhotos("Diamond lot D515", ["bbbbbbbb.jpg"], LIBRARY);
    expect(photo.alt).toBe("Diamond lot D515");
  });

  it("carries the credit through when the library has one", () => {
    const [photo] = resolveParkingPhotos("Diamond lot D515", ["bbbbbbbb.jpg"], LIBRARY);
    expect(photo.credit).toBe("Jane Doe");
    const [described] = resolveParkingPhotos("Port lot", ["aaaaaaaa.jpg"], LIBRARY);
    expect(described.credit).toBeUndefined();
  });

  it("DROPS a name the library no longer holds rather than rendering a broken image", () => {
    // The restore case: an older zone version referencing bytes that have since
    // been tombstoned. A broken image icon inside a map popup is worse than one
    // fewer photo.
    const out = resolveParkingPhotos("Port lot", ["gone.jpg", "aaaaaaaa.jpg"], LIBRARY);
    expect(out.map((p) => p.name)).toEqual(["aaaaaaaa.jpg"]);
  });

  it("de-duplicates repeated names", () => {
    const out = resolveParkingPhotos("Port lot", ["aaaaaaaa.jpg", "aaaaaaaa.jpg"], LIBRARY);
    expect(out).toHaveLength(1);
  });

  it("returns nothing for a zone with no photos — the seed-data case", () => {
    expect(resolveParkingPhotos("Port lot", undefined, LIBRARY)).toEqual([]);
    expect(resolveParkingPhotos("Port lot", [], LIBRARY)).toEqual([]);
  });

  it("never emits an empty alt: every rendered photo announces something", () => {
    const out = resolveParkingPhotos("Port lot", [...LIBRARY.keys()], LIBRARY);
    expect(out).toHaveLength(3);
    for (const p of out) expect(p.alt.trim().length).toBeGreaterThan(0);
  });
});

describe("resolveParkingPhotoAlt", () => {
  it("trims, so a whitespace-only description still falls back", () => {
    expect(resolveParkingPhotoAlt("Port lot", item({ id: "x.jpg", alt: "   " }))).toBe("Port lot");
  });
});

describe("hasUndescribedPhoto", () => {
  it("is the admin-facing signal for the gap the fallback papers over", () => {
    expect(hasUndescribedPhoto(["bbbbbbbb.jpg"], LIBRARY)).toBe(true);
    expect(hasUndescribedPhoto(["aaaaaaaa.jpg"], LIBRARY)).toBe(false);
    expect(hasUndescribedPhoto(undefined, LIBRARY)).toBe(false);
  });

  it("ignores a name that is not in the library — that one is dropped, not undescribed", () => {
    expect(hasUndescribedPhoto(["gone.jpg"], LIBRARY)).toBe(false);
  });
});
