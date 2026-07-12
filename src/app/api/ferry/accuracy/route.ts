// GET|POST /api/ferry/accuracy
//
// Runs the forecast accuracy backtest (heuristic prediction vs. logged observed
// fullness for every sailing) and records a snapshot to the rolling history, so
// the Chamber can validate the model before trusting it publicly. Meant for a
// daily scheduler — see .github/workflows/ferry-accuracy.yml.
//
// Same optional-token gate as /api/ferry/observe: if FERRY_OBSERVE_TOKEN is set,
// a matching ?token= or `Authorization: Bearer` is required.

import type { NextRequest } from "next/server";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { recordAccuracySnapshot } from "@/lib/stores/ferry-observations";

export const dynamic = "force-dynamic";

async function handle(request: NextRequest): Promise<Response> {
  const expected = process.env.FERRY_OBSERVE_TOKEN;
  if (expected) {
    const provided =
      request.nextUrl.searchParams.get("token") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (provided !== expected) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request);
}
