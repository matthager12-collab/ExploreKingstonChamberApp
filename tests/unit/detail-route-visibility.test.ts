// Behavioural proof for the section-detail gates (the /itineraries/<slug>
// find, 2026-08-19).
//
// tests/unit/visibility-gate-guard.test.ts proves the gate CALL exists in the
// source. It cannot prove the call runs before the page's own store read, and
// that ordering is the whole property: a gate placed after `getItinerary` would
// still 404, but only after the store had already answered "does this slug
// exist" — the timing/shape difference between a hidden-real slug and a
// hidden-nonexistent one is exactly the leak the section hide is meant to close.
//
// Rejection alone cannot prove ordering — a gate placed after the store read
// still throws, just later. So the ordering test asserts on the STORE SPY:
// when the section is hidden, the detail store must never have been called.
// That is the one observable that distinguishes the two placements (verified
// by moving the gate below the read and watching only that test go red).
//
// generateMetadata is covered as its OWN entry point. Calling a page's default
// export directly — which is what this file does — never runs it, so it is
// exactly the kind of gap a direct-invocation test cannot see: it runs on the
// same request, reads the same record store, and ungated it would answer a
// hidden section with the record's real title for a live slug and the fallback
// for a bogus one. Same exists-oracle, relocated into <head>.
//
// Node environment, no DOM: an async server component returns an element tree,
// and we only need to know whether awaiting it throws. The gate under test is
// the real assertPageVisible — only its two data dependencies (the page-settings
// store and the session read) are mocked, so the hidden/admin logic is genuinely
// exercised rather than restated.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hunt, Itinerary } from "@/lib/types";

const NOT_FOUND = "NEXT_NOT_FOUND";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

const getPageSettings = vi.fn();
const getSessionUser = vi.fn();

vi.mock("@/lib/stores/site-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stores/site-store")>()),
  getPageSettings: () => getPageSettings(),
}));

vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));

const ITINERARY: Itinerary = {
  id: "it-1",
  slug: "walk-on-half-day",
  title: "Walk-on half day",
  tagline: "Off the boat and back again.",
  duration: "4 hours",
  mode: "walk-on",
  audience: ["couples"],
  stops: [{ time: "10:00", title: "Coffee", description: "Start here." }],
};

const HUNT: Hunt = {
  id: "h-1",
  slug: "downtown-loop",
  title: "Downtown loop",
  description: "A short walk.",
  difficulty: "easy",
  durationMinutes: 45,
  stops: [
    {
      id: "s-1",
      title: "The dock",
      clue: "Where the boat lands.",
      hint: "Look for water.",
      lat: 47.797,
      lng: -122.496,
      radiusMeters: 40,
      photoPrompt: "Photograph the dock.",
      funFact: "It is old.",
    },
  ],
};

// Spies, not plain stubs: "was the detail record ever read" is the assertion
// that pins the gate above the store read.
const getItinerary = vi.fn(async (slug: string) =>
  slug === ITINERARY.slug ? ITINERARY : undefined,
);
const getHunt = vi.fn(async (slug: string) => (slug === HUNT.slug ? HUNT : undefined));

vi.mock("@/lib/stores/itinerary-store", () => ({ getItinerary: (s: string) => getItinerary(s) }));

vi.mock("@/lib/hunt-store", () => ({
  getHunt: (s: string) => getHunt(s),
  photoUrl: (p: string) => `/api/hunts/photo?p=${p}`,
}));

/** The store rows Admin → Site content writes when a section is hidden. */
function hide(...paths: string[]) {
  getPageSettings.mockResolvedValue(paths.map((id) => ({ id, hidden: true })));
}

const SECTIONS = [
  {
    label: "/itineraries",
    section: "/itineraries",
    slug: ITINERARY.slug,
    store: getItinerary,
    load: () => import("@/app/(site)/itineraries/[slug]/page"),
  },
  {
    label: "/hunt",
    section: "/hunt",
    slug: HUNT.slug,
    store: getHunt,
    load: () => import("@/app/(site)/hunt/[slug]/page"),
  },
] as const;

describe.each(SECTIONS)("$label/<slug> honours the section hide", ({ section, slug, store, load }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPageSettings.mockResolvedValue([]);
    getSessionUser.mockResolvedValue(null);
  });

  const render = async () => {
    const { default: Page } = await load();
    return Page({ params: Promise.resolve({ slug }) });
  };

  it("404s for a visitor when the section is hidden — even though the slug exists", async () => {
    hide(section);
    await expect(render()).rejects.toThrow(NOT_FOUND);
  });

  it("still renders for a visitor while the section is visible", async () => {
    await expect(render()).resolves.toBeTruthy();
  });

  it("renders for a signed-in admin so the Chamber can preview a hidden section", async () => {
    hide(section);
    getSessionUser.mockResolvedValue({ role: "admin" });
    await expect(render()).resolves.toBeTruthy();
  });

  it("is not fooled by a different section being hidden", async () => {
    hide("/eat", "/stay");
    await expect(render()).resolves.toBeTruthy();
  });

  it("gates ABOVE its own store read, so a hidden section leaks nothing", async () => {
    // The gate must answer before the detail record is fetched. If it sat below
    // the read, the page would still 404 — but only after the store had told it
    // whether the slug exists, and a hidden section would stay a working oracle
    // for "which records are in here". An untouched spy is that guarantee.
    hide(section);
    await expect(render()).rejects.toThrow(NOT_FOUND);
    expect(
      store,
      "the gate is below the store read — move it above so the hidden section " +
        "cannot be probed for which slugs exist",
    ).not.toHaveBeenCalled();
  });

  it("gates generateMetadata too, so <head> is not a second exists-oracle", async () => {
    hide(section);
    const { generateMetadata } = await load();
    await expect(generateMetadata({ params: Promise.resolve({ slug }) })).rejects.toThrow(
      NOT_FOUND,
    );
    expect(
      store,
      "generateMetadata read the record before checking visibility — a hidden " +
        "section would title its 404 with the real record name",
    ).not.toHaveBeenCalled();
  });

  it("still titles the page for an admin previewing a hidden section", async () => {
    hide(section);
    getSessionUser.mockResolvedValue({ role: "admin" });
    const { generateMetadata } = await load();
    await expect(
      generateMetadata({ params: Promise.resolve({ slug }) }),
    ).resolves.toMatchObject({ title: expect.stringContaining("") });
  });

  it("answers a hidden section identically for a real and a bogus slug", async () => {
    hide(section);
    const { default: Page } = await load();
    await expect(Page({ params: Promise.resolve({ slug }) })).rejects.toThrow(NOT_FOUND);
    await expect(Page({ params: Promise.resolve({ slug: "no-such-slug" }) })).rejects.toThrow(
      NOT_FOUND,
    );
  });
});
