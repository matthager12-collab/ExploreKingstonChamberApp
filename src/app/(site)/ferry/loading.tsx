// Instant-navigation skeleton for the ferry segment (/ferry and /ferry/plan)
// — the dead-click route: dynamic via cookies(), cold renders measured at
// 6.6-8.5s, and without a loading.tsx dynamic routes prefetch NOTHING, so a
// nav tap showed zero feedback the whole time. See
// src/components/route-loading-skeleton.tsx for the full placement rationale.
//
// KNOWN TRADE-OFF (accepted, see PR): with this boundary, a notFound() thrown
// below it streams the not-found body under an HTTP 200 + noindex meta rather
// than a status 404 (bundled loading.md §"Status Codes"). That affects only
// two dark states in this segment: an admin explicitly hiding Ferry
// (assertPageVisible), and /ferry/plan while the prediction flag is off.
// Neither has a status-code floor test — the one hard status floor, /es,
// stays outside every loading boundary (tests/unit/hidden-page-404-guard.test.ts).

import { RouteLoadingSkeleton } from "@/components/route-loading-skeleton";

export default function Loading() {
  return <RouteLoadingSkeleton />;
}
