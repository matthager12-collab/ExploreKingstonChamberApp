// "Which side of the water are you on?" — the Kingston–Edmonds crossing framing.
//
// Kingston side (the app's home base, default) = the visitor is in/near Kingston
// and cares about LEAVING it. Edmonds side = the visitor is across Puget Sound
// and cares about GETTING to Kingston. This module is client-safe on purpose:
// it holds only the type, cookie name, geo divide, and a pure classifier, so it
// can be imported from both server components and "use client" components. The
// cookie read (server-only, needs next/headers) lives in ./side-server.

export type WaterSide = "kingston" | "edmonds";

export const SIDE_COOKIE = "vk-side";

// Historical note: a "vk-side-asked" cookie once suppressed a first-visit
// geolocation auto-ask. That opt-out ask was removed (MHMDA consent floor —
// location is user-initiated only, via the side-switcher's button), so the
// cookie is no longer set or read; stale copies on visitors' devices are inert.

// Mid-Sound longitude between the Kingston (≈ -122.497) and Edmonds (≈ -122.383)
// terminals. West of it = Kingston side; east = Edmonds side.
export const SIDE_DIVIDE_LNG = -122.44;

/** Which side a lat/lng is on, or null if it's not near the Kingston–Edmonds crossing. */
export function sideFromLngLat(lat: number, lng: number): WaterSide | null {
  if (lat < 47.4 || lat > 48.2 || lng < -123.2 || lng > -122.1) return null;
  return lng < SIDE_DIVIDE_LNG ? "kingston" : "edmonds";
}
