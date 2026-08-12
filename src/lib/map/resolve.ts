// Resolve a MapView into everything the client map needs to render: the view
// config, its custom features, and lightweight payloads for the built-in data
// layers (restaurants, parking zones, streets) the view includes.
//
// Server-only (reads stores + seed data). Streets are flagged rather than
// inlined — the client fetches the static /geo/street-parking.json directly.

import type { ResolvedMapView } from "./types";
import { restaurantCategory } from "./restaurant-category";
import { getMapView, getFeaturesForView } from "../stores/map-store";
import { getRestaurants } from "../stores/business-store";
import { getParkingZones } from "../stores/parking-store";
import { getBayTransforms } from "../stores/bay-transform-store";
import { getMediaItems } from "../stores/media-store";
import { resolveParkingPhotos } from "./parking-photos";
import { getDirectoryListings } from "../stores/directory-store";
import { isActiveMemberStatus, listMemberMeta } from "../db/member-meta";
import { normalizeName } from "../import/qwick";

/** DirectoryListing.category → MARKER_CATEGORIES key. Coarse on purpose —
 *  the fine-grained icons stay a hand-pin affordance; a listing-sourced pin
 *  gets the honest generic for its bucket. */
const DIRECTORY_MARKER_CATEGORY: Record<string, string> = {
  eat: "food",
  stay: "lodging",
  shop: "shop",
  services: "services",
  activities: "star",
  community: "info",
  other: "info",
};

/** Popup teaser, code-point safe (same rule as the /directory card blurb). */
function popupBlurb(description: string): string | undefined {
  const text = description.trim();
  if (!text) return undefined;
  const points = [...text];
  if (points.length <= 120) return text;
  return `${points.slice(0, 119).join("").trimEnd()}…`;
}

export async function resolveMapView(viewId: string): Promise<ResolvedMapView | null> {
  const view = await getMapView(viewId);
  if (!view) return null;

  const features = await getFeaturesForView(viewId);
  const builtins: ResolvedMapView["builtins"] = {};

  if (view.sources.includes("restaurants")) {
    const restaurants = (await getRestaurants()).filter((r) => !r.hidden);
    builtins.restaurants = restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      walkMinutesFromFerry: r.walkMinutesFromFerry,
      category: restaurantCategory(r),
      label: { text: r.name }, // name-as-label survives field stripping (disambiguates look-alike pins)
    }));
  }

  if (view.sources.includes("parking-zones")) {
    const zones = await getParkingZones();
    // Photos resolve to src+alt HERE rather than on the client: the map popup
    // is built as an HTML string inside feature-map.tsx and has no way to reach
    // the media store, and shipping bare library names would force every
    // consumer to re-implement the alt-text fallback (and drift from it).
    // Read once for the whole layer, not per zone.
    const library = new Map((await getMediaItems()).map((m) => [m.id, m]));
    builtins.parkingZones = zones.map((z) => {
      const photos = resolveParkingPhotos(z.name, z.images, library);
      return {
        id: z.id,
        name: z.name,
        rule: z.rule,
        summary: z.summary,
        center: z.center,
        polygon: z.polygon,
        streetPaths: z.streetPaths,
        curb: z.curb,
        ...(photos.length ? { photos } : {}),
      };
    });
  }

  // Directory-public slice, phase 3 — two jobs, one LIVE-only read:
  //
  //  (1) the `directory` source: pins from real listings that carry
  //      coordinates (geocode pass / admin placement), filtered to the
  //      view's directoryCategories when set. This is the seam map-views.ts
  //      reserved — the layer that retires the hand-drawn shopping pins.
  //  (2) profileLinks: for EVERY view, custom marker features whose
  //      normalized title matches a live listing get that listing's
  //      /directory/[id] path, so the existing hand pins become clickable
  //      business profiles without waiting for (or duplicating) geocoding.
  //
  // The public getter's E08 gate does the draft filtering; member_meta is
  // read server-side and only the member-or-not fact leaves.
  {
    const listings = await getDirectoryListings();
    if (listings.length > 0) {
      const byName = new Map<string, { id: string }[]>();
      for (const l of listings) {
        const key = normalizeName(l.name);
        if (!key) continue;
        const bucket = byName.get(key) ?? [];
        bucket.push({ id: l.id });
        byName.set(key, bucket);
      }
      const profileLinks: Record<string, string> = {};
      for (const f of features) {
        if (f.kind !== "marker") continue;
        const matches = byName.get(normalizeName(f.title)) ?? [];
        // Ambiguity = no link; a wrong profile is worse than none.
        if (matches.length === 1) profileLinks[f.id] = `/directory/${matches[0].id}`;
      }
      if (Object.keys(profileLinks).length > 0) builtins.profileLinks = profileLinks;
    }

    if (view.sources.includes("directory")) {
      const meta = await listMemberMeta("directory");
      const memberById = new Map(
        meta.map((m) => [m.subjectId, isActiveMemberStatus(m.memberStatus)]),
      );
      const wanted =
        view.directoryCategories && view.directoryCategories.length > 0
          ? new Set(view.directoryCategories)
          : null;
      builtins.directory = listings
        .filter(
          (l) =>
            l.lat !== undefined &&
            l.lng !== undefined &&
            (!wanted || wanted.has(l.category)),
        )
        .map((l) => ({
          id: l.id,
          name: l.name,
          lat: l.lat!,
          lng: l.lng!,
          category: DIRECTORY_MARKER_CATEGORY[l.category] ?? "info",
          member: memberById.get(l.id) ?? false,
          ...(popupBlurb(l.description) ? { blurb: popupBlurb(l.description) } : {}),
          profilePath: `/directory/${l.id}`,
          label: { text: l.name },
        }));
    }
  }

  if (view.sources.includes("streets")) {
    builtins.streets = true;
  }

  // Port bay geometry: the 84 KB of generated polygons stays a static file the
  // client fetches, exactly like streets. Only the admin's per-zone nudges
  // travel on the view payload, because they are the one part that can change
  // without a deploy. Read even when empty so the client can tell "no
  // corrections" from "corrections not loaded".
  if (view.sources.includes("port-stalls")) {
    builtins.portStalls = { transforms: await getBayTransforms() };
  }

  return { view, features, builtins };
}
