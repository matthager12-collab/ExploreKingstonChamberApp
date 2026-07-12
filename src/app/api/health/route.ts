// Liveness + readiness probe for the hosting platform (Render/Fly/Railway
// health checks, uptime monitors). Confirms the process is up, the persistent
// data directory is writable (images/photos still live on disk), AND — since
// E05 — that Postgres answers (structured data has no filesystem fallback).
// The DB gate makes deploys fail-closed: a substrate release started without
// DATABASE_URL never reports healthy, so Render keeps routing to the previous
// release instead of serving a broken one.

import { mkdir, writeFile, unlink } from "fs/promises";
import { dataDir, dataPath } from "@/lib/data-dir";
import { dbHealthy } from "@/lib/db/records";

export const dynamic = "force-dynamic";

export async function GET() {
  const probe = dataPath(".health-probe");
  let dataWritable = false;
  try {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(probe, String(Date.now()), "utf8");
    await unlink(probe);
    dataWritable = true;
  } catch {
    dataWritable = false;
  }

  const dbOk = await dbHealthy();

  const ok = dataWritable && dbOk;
  const body = {
    ok,
    dataDir: dataDir(),
    dataWritable,
    dbOk,
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: ok ? 200 : 503 });
}
