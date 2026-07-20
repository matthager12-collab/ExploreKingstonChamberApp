// Liveness + readiness probe for the hosting platform (Render/Fly/Railway
// health checks, uptime monitors). Confirms the process is up, the persistent
// data directory is writable (images/photos still live on disk), AND — since
// E05 — that Postgres answers (structured data has no filesystem fallback).
// The DB gate makes deploys fail-closed: a substrate release started without
// DATABASE_URL never reports healthy, so Render keeps routing to the previous
// release instead of serving a broken one.

import { dataDir } from "@/lib/data-dir";
import { dbHealthy } from "@/lib/db/records";
import { probeDataDir } from "@/lib/ops-health";

export const dynamic = "force-dynamic";

export async function GET() {
  // The write-probe now lives in src/lib/ops-health.ts so /admin/ops and this
  // readiness gate share ONE implementation. The wire body below is unchanged
  // (Render + UptimeRobot depend on the keys and the 200/503 semantics).
  const data = await probeDataDir();
  const dbOk = await dbHealthy();

  const ok = data.ok && dbOk;
  const body = {
    ok,
    dataDir: dataDir(),
    dataWritable: data.ok,
    dbOk,
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: ok ? 200 : 503 });
}
