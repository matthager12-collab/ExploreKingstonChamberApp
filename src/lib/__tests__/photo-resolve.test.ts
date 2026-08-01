// Photo slot resolution — which image renders, and what it announces.
//
// The alt-text branches are pinned deliberately. resolveAlt encodes a decision
// with a known cost (a content slot with no description anywhere borrows the
// SLOT's shipped alt, which describes the photo that used to be there), and a
// decision like that is only safe if changing it is loud.

import { describe, expect, it } from "vitest";
import { isAltStale, resolvePhoto, resolveAlt } from "@/lib/photo-resolve";
import { KIOSK_ATTRACT_KEYS, photoSlot } from "@/lib/photo-slots";
import type { MediaItem } from "@/lib/media/refs";

function item(over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "abcdef0123456789.jpg",
    title: "harbor",
    alt: "The ferry dock at first light",
    addedAt: "2026-07-31",
    bytes: 1024,
    ...over,
  };
}

const library = (i: MediaItem) => ({ [i.id]: i });

describe("resolvePhoto — which image renders", () => {
  it("uses the shipped /brand asset when no override exists", () => {
    const got = resolvePhoto("home.strip.1", undefined, {});
    expect(got.src).toBe(photoSlot("home.strip.1").fallback);
    expect(got.alt).toBe(photoSlot("home.strip.1").fallbackAlt);
  });

  it("serves an override through the media proxy, never a bucket URL", () => {
    const i = item();
    const got = resolvePhoto("home.strip.1", { name: i.id }, library(i));
    expect(got.src).toBe(`/api/media/${i.id}`);
  });

  it("falls back when the override points at a photo no longer in the library", () => {
    // Reachable in production: the photo was removed, or an audit restore
    // brought back a slot row whose photo is gone. A broken image on the home
    // page is a worse outcome than the shipped default.
    const got = resolvePhoto("home.strip.2", { name: "deadbeefdeadbeef.jpg" }, {});
    expect(got.src).toBe(photoSlot("home.strip.2").fallback);
  });

  it("carries the photographer credit through when the library has one", () => {
    const i = item({ credit: "J. Doe" });
    expect(resolvePhoto("home.strip.1", { name: i.id }, library(i)).credit).toBe("J. Doe");
    const plain = item();
    expect(resolvePhoto("home.strip.1", { name: plain.id }, library(plain)).credit).toBeUndefined();
  });
});

describe("resolveAlt — what it announces", () => {
  it("says nothing for a decorative slot, whatever the library holds", () => {
    // The hero sits behind the headline; describing it puts noise between the
    // page title and the content. This holds even with a described photo and
    // even with a per-slot override — decorative wins outright.
    const i = item({ alt: "A description that must not be announced" });
    expect(resolveAlt("home.hero", { name: i.id }, i)).toBe("");
    expect(resolveAlt("home.hero", { name: i.id, alt: "nor this" }, i)).toBe("");
    expect(resolvePhoto("home.hero", { name: i.id }, library(i)).alt).toBe("");
  });

  it("prefers a per-slot override over the library description", () => {
    const i = item();
    expect(resolveAlt("home.strip.1", { name: i.id, alt: "Said for this spot" }, i)).toBe(
      "Said for this spot",
    );
  });

  it("uses the library description by default", () => {
    const i = item();
    expect(resolveAlt("home.strip.1", { name: i.id }, i)).toBe("The ferry dock at first light");
  });

  it("treats whitespace-only alt as absent at both levels", () => {
    const i = item({ alt: "   " });
    expect(resolveAlt("home.strip.1", { name: i.id, alt: "  " }, i)).toBe(
      photoSlot("home.strip.1").fallbackAlt,
    );
  });

  // ---- the pinned decision ----
  it("borrows the SLOT's shipped alt when nothing describes the photo", () => {
    const i = item({ alt: "" });
    const got = resolveAlt("home.strip.1", { name: i.id }, i);
    expect(got).toBe(photoSlot("home.strip.1").fallbackAlt);
    // Stated plainly: this text describes the ORIGINAL photo for this position.
    // It is a deliberate trade against an empty alt, whose cost is silence.
    // Changing it is a product decision, not a refactor.
    expect(got).toContain("Point No Point lighthouse");
  });
});

describe("kiosk attract loop", () => {
  it("every key in the loop is a registered slot with a shipped photo", () => {
    // The layout maps over KIOSK_ATTRACT_KEYS and photoSlot() would throw on an
    // unregistered key — on the layout of an unattended panel at the dock.
    for (const key of KIOSK_ATTRACT_KEYS) {
      const slot = photoSlot(key);
      expect(slot, `${key} is not registered`).toBeDefined();
      expect(slot.fallback).toMatch(/^\/brand\//);
    }
  });

  it("is decorative throughout, so nothing announces over the button's own label", () => {
    // The attract overlay is one <button aria-label="Touch to explore
    // Kingston">. An aria-label overrides its contents, so per-image alt is
    // dropped by assistive tech — and the picker must not ask for descriptions
    // that can never be heard.
    for (const key of KIOSK_ATTRACT_KEYS) {
      expect(photoSlot(key).decorative, `${key} should be decorative`).toBe(true);
      const i = item();
      expect(resolvePhoto(key, { name: i.id }, library(i)).alt).toBe("");
    }
  });

  it("resolves an admin-chosen photo but never leaves the stage blank", () => {
    const i = item();
    expect(resolvePhoto("kiosk.attract.1", { name: i.id }, library(i)).src).toBe(
      `/api/media/${i.id}`,
    );
    // A dangling reference falls back rather than rendering nothing — a blank
    // panel at the ferry dock is the failure mode that actually matters here.
    expect(resolvePhoto("kiosk.attract.1", { name: "deadbeefdeadbeef.jpg" }, {}).src).toBe(
      photoSlot("kiosk.attract.1").fallback,
    );
  });
});

describe("isAltStale — the signal the admin UI raises", () => {
  it("flags a content slot whose photo has no description", () => {
    const i = item({ alt: "" });
    expect(isAltStale("home.strip.1", { name: i.id }, library(i))).toBe(true);
  });

  it("does not flag a described photo, a per-slot override, or a decorative slot", () => {
    const described = item();
    expect(isAltStale("home.strip.1", { name: described.id }, library(described))).toBe(false);

    const bare = item({ alt: "" });
    expect(isAltStale("home.strip.1", { name: bare.id, alt: "written here" }, library(bare))).toBe(
      false,
    );
    expect(isAltStale("home.hero", { name: bare.id }, library(bare))).toBe(false);
  });

  it("does not flag an untouched slot or a dangling reference", () => {
    // Nothing to fix in either case: one is the shipped default, the other
    // already falls back to it.
    expect(isAltStale("home.strip.1", undefined, {})).toBe(false);
    expect(isAltStale("home.strip.1", { name: "deadbeefdeadbeef.jpg" }, {})).toBe(false);
  });
});
