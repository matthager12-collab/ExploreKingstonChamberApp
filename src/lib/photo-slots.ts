// The site-wide photo-slot registry — the photo half of what
// site-copy-registry.ts does for text, and deliberately the same shape.
//
// Each PhotoSlot names one photo position on a public surface. The `fallback`
// is the /brand/ asset the site ships with; an admin who picks a library photo
// for that slot overrides it, and "Reset to default" is truthful because the
// default lives here rather than inline at the call site.
//
// TWO KINDS OF SLOT, and the difference is an accessibility one, not a
// cosmetic one:
//
//   DECORATIVE (`decorative: true`) — the photo carries no information a
//   visitor would miss. The home hero is the case in point: it sits BEHIND the
//   headline, and the headline already says everything. It renders alt="" and
//   the admin UI must not ask for alt text, because inventing a description for
//   a backdrop makes a screen reader announce noise between the page title and
//   the actual content. This is why the hero has alt="" in the code today.
//
//   CONTENT (default) — the photo IS the content, so it needs a description.
//   The three "This is Kingston" tiles are content: a visitor who cannot see
//   them has been shown nothing without alt text.
//
// Key naming mirrors the copy registry: "<page>.<block>".

export interface PhotoSlot {
  key: string;
  /** Group heading in the admin editor — a page or surface name. */
  page: string;
  label: string;
  help?: string;
  /** The /brand/ asset used when no admin override exists. */
  fallback: string;
  /** Alt text for the fallback. Omitted (and unused) on decorative slots. */
  fallbackAlt?: string;
  /** See the note above — decorative slots render alt="" and never prompt. */
  decorative?: boolean;
  /** Aspect ratio for the admin preview tile, as a CSS aspect-ratio value. */
  aspect?: string;
  /**
   * True when this slot is (or contains) the page's Largest Contentful Paint
   * element. The Lighthouse CI gate has a real performance floor, and E15
   * slice 5c traced a 5.4s LCP to a single oversized image — so the admin UI
   * warns before someone puts a 10MB photo in one of these.
   */
  lcp?: boolean;
}

export const PHOTO_SLOTS = [
  {
    key: "home.hero",
    page: "Home",
    label: "Hero background",
    help: "The full-width photo behind the headline. Landscape, and keep the middle uncluttered — the headline sits on top of it.",
    fallback: "/brand/photo-kingston-37.jpg",
    decorative: true,
    aspect: "16 / 9",
    lcp: true,
  },
  {
    key: "home.strip.1",
    page: "Home",
    label: "“This is Kingston” tile 1",
    fallback: "/brand/photo-hansville-hero.jpg",
    fallbackAlt:
      "Point No Point lighthouse in Hansville with Puget Sound and the Cascades behind",
    aspect: "4 / 3",
  },
  {
    key: "home.strip.2",
    page: "Home",
    label: "“This is Kingston” tile 2",
    fallback: "/brand/photo-kingston-59.jpg",
    fallbackAlt: "Aerial view of Kingston's harbor and marina wrapped in evergreen forest",
    aspect: "4 / 3",
  },
  {
    key: "home.strip.3",
    page: "Home",
    label: "“This is Kingston” tile 3",
    fallback: "/brand/photo-kingston-harbor-35.jpg",
    fallbackAlt: "Coastal townhomes near the Kingston waterfront in warm evening light",
    aspect: "4 / 3",
  },
  {
    key: "share.og",
    page: "Sharing",
    label: "Link preview image",
    help: "Shown when someone shares the home page on Facebook, Messages, or Slack. Landscape; text baked into the image is usually cropped.",
    fallback: "/brand/photo-hansville-hero.jpg",
    fallbackAlt: "Point No Point across Puget Sound near Kingston, Washington",
    aspect: "1200 / 630",
  },
] as const satisfies readonly PhotoSlot[];

// WHY share.og IS SCOPED TO THE HOME PAGE and not the whole site: the site-wide
// preview image lives in the ROOT layout's static `metadata`. Making that
// admin-editable means turning it into an async generateMetadata(), which then
// runs two store reads on EVERY route — for a photo the Chamber changes about
// once a year. The home page already resolves photo slots and is already
// dynamic, and a shared link is nearly always the home page, so overriding it
// there gets essentially all of the value at no cost. Other routes keep the
// layout's shipped default. If per-page previews are ever wanted, add slots and
// per-page generateMetadata — do NOT move this into the root layout.

/** Union of every registered slot key — a typo at a call site is a tsc error. */
export type PhotoSlotKey = (typeof PHOTO_SLOTS)[number]["key"];

const BY_KEY = new Map<string, PhotoSlot>(PHOTO_SLOTS.map((s) => [s.key, s]));

export function photoSlot(key: PhotoSlotKey): PhotoSlot {
  return BY_KEY.get(key)!;
}

/** One resolved placement, ready to hand to <Image>. */
export interface ResolvedPhoto {
  src: string;
  alt: string;
  credit?: string;
}
