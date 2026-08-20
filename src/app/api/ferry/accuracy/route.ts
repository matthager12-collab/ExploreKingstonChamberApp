// POST /api/ferry/accuracy
//
// Runs the forecast accuracy backtest (heuristic prediction vs. logged observed
// fullness for every sailing) and records a snapshot to the rolling history, so
// the Chamber can validate the model before trusting it publicly. Meant for a
// daily scheduler — the Render cron (render.yaml `ferry-accuracy`) POSTs.
//
// Auth: the same gate as /api/ferry/observe (checkFerryObserveAuth) —
// `Authorization: Bearer $FERRY_OBSERVE_TOKEN`, header only, FAIL-CLOSED when
// the token is unset (503 outside development). POST only: recording a
// snapshot is a write, and the cron POSTs.

import type { NextRequest } from "next/server";
import { checkFerryObserveAuth } from "@/lib/ferry-observe-auth";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { recordAccuracySnapshot } from "@/lib/stores/ferry-observations";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const denied = checkFerryObserveAuth(request);
  if (denied) return denied;

  try {
    const metrics = await recordAccuracySnapshot({ actor: "system", source: "sync" });
    return Response.json({ ok: true, metrics });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
