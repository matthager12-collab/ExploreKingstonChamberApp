// Where to send drivers when the SR-104 vehicle boarding-pass system is ON.
//
// The destination is NOT the dock — it's the staging point at the end of the
// SR-104 holding line, given by the Chamber. Just handing Google the point,
// though, lets it route a driver in from the wrong side and U-turn straight
// into the line. So the route is FORCED through the Barber Cutoff Rd junction
// as a waypoint: everyone comes down SR 104 from the west into the line, and
// anyone who overshoots (or comes from Kingston) loops at Barber Cutoff — or
// Miller Bay further south — instead of a mid-highway U-turn.

/** End of the SR-104 ferry holding line — the navigate destination when a pass is required. */
export const FERRY_LINE_STAGING = { lat: 47.8036774, lng: -122.506024 } as const;

/** SR 104 & NE Barber Cutoff Rd — forced waypoint so the approach comes from the west. */
export const FERRY_LINE_APPROACH = { lat: 47.8085, lng: -122.518 } as const;

/**
 * Google Maps driving directions to the ferry line staging point, routed via
 * the Barber Cutoff junction so drivers never U-turn into the line early.
 * No API key — a universal Maps URL with one waypoint.
 */
export function ferryLineNavUrl(): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${FERRY_LINE_STAGING.lat},${FERRY_LINE_STAGING.lng}`,
    waypoints: `${FERRY_LINE_APPROACH.lat},${FERRY_LINE_APPROACH.lng}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
