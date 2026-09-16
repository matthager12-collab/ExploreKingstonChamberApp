// POST /api/ferry/observe
//
// Records one snapshot of Edmonds–Kingston sailing fullness + delay into the
// observation log, so the trip planner's busyness model keeps learning even
// when nobody's on the site. The status pipeline already captures snapshots on
// organic traffic (throttled); the Render cron (render.yaml `ferry-observe`,
// every ~15 min during service hours) covers overnight gaps.
//
// Auth: checkFerryObserveAuth — `Authorization: Bearer $FERRY_OBSERVE_TOKEN`,
// header only, FAIL-CLOSED when the token is unset (503 outside development).
// POST only: this route writes to the observation log on every hit, and the
// cron POSTs — a write should never be reachable by a bare link or prefetch.
//
// The write is throttled internally, so hitting this more often than the
// throttle window is harmless (it just returns recorded:false).

import type { NextRequest } from "next/server";
import { checkFerryObserveAuth } from "@/lib/ferry-observe-auth";
import { getRouteDelays, getSailingSpace } from "@/lib/wsf";
import { recordSailingSpaceSnapshot } from "@/lib/stores/ferry-observations";

// This route mutates state on every hit — never prerender or cache it.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const denied = checkFerryObserveAuth(request);
  if (denied) return denied;

  const [kingston, edmonds, delays] = await Promise.all([
    getSailingSpace("kingston"),
    getSailingSpace("edmonds"),
    getRouteDelays(),
  ]);
  const recorded = await recordSailingSpaceSnapshot({ kingston, edmonds }, delays);

  return Response.json({ ok: true, recorded });
}
