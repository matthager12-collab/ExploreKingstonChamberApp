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
import { getMediaItems } from "../stores/media-store";
import { resolveParkingPhotos } from "./parking-photos";

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

  if (view.sources.includes("streets")) {
    builtins.streets = true;
  }

  return { view, features, builtins };
}
