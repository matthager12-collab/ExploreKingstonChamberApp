// Resolve a MapView into everything the client map needs to render: the view
// config, its custom features, and lightweight payloads for the built-in data
// layers (restaurants, parking zones, streets) the view includes.
//
// Server-only (reads stores + seed data). Streets are flagged rather than
// inlined — the client fetches the static /geo/street-parking.json directly.

import type { ResolvedMapView } from "./types";
import type { Restaurant } from "../types";
import { getMapView, getFeaturesForView } from "../stores/map-store";
import { getRestaurants } from "../stores/business-store";
import { getParkingZones } from "../stores/parking-store";

/** Pick a marker-palette category so coffee/bars get their own pin, not 🍽️. */
function restaurantCategory(r: Restaurant): string {
  const hay = `${r.cuisine} ${r.tags.join(" ")}`.toLowerCase();
  if (/coffee|espresso|caf[eé]|bakery|muffin|matcha/.test(hay)) return "coffee";
  if (/\b(bar|brew|brewery|taproom|pub|wine|beer|lounge|cocktail|jazz)\b/.test(hay))
    return "drink";
  return "food";
}

export async function resolveMapView(viewId: string): Promise<ResolvedMapView | null> {
  const view = await getMapView(viewId);
  if (!view) return null;

  const features = await getFeaturesForView(viewId);
  const builtins: ResolvedMapView["builtins"] = {};

  if (view.sources.includes("restaurants")) {
    const restaurants = await getRestaurants();
    builtins.restaurants = restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      walkMinutesFromFerry: r.walkMinutesFromFerry,
      category: restaurantCategory(r),
    }));
  }

  if (view.sources.includes("parking-zones")) {
    const zones = await getParkingZones();
    builtins.parkingZones = zones.map((z) => ({
      id: z.id,
      name: z.name,
      rule: z.rule,
      summary: z.summary,
      center: z.center,
      polygon: z.polygon,
    }));
  }

  if (view.sources.includes("streets")) {
    builtins.streets = true;
  }

  return { view, features, builtins };
}
