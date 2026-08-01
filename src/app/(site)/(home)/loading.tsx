// Instant-navigation skeleton for the home page. The (home) route group
// exists precisely so this boundary covers "/" and nothing else: home is
// dynamic (cookies() via getSide), so without a loading.tsx it prefetches
// nothing and a nav tap gives zero feedback until the full server response.
// Home is deliberately not hideable (page-visibility.tsx), so no notFound()
// can ever land under this boundary — the streamed-404 status trap that keeps
// loading.tsx away from /es does not apply here. See
// src/components/route-loading-skeleton.tsx for the full placement rationale.

import { RouteLoadingSkeleton } from "@/components/route-loading-skeleton";

export default function Loading() {
  return <RouteLoadingSkeleton />;
}
