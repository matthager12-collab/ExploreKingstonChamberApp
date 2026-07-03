// Liveness + readiness probe for the hosting platform (Render/Fly/Railway
// health checks, uptime monitors). Confirms the process is up AND that the
// persistent data directory is writable — a read-only or unmounted volume is
// the failure this app most needs to catch before real users hit it.

import { mkdir, writeFile, unlink } from "fs/promises";
import { dataDir, dataPath } from "@/lib/data-dir";

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

  const body = {
    ok: dataWritable,
    dataDir: dataDir(),
    dataWritable,
    time: new Date().toISOString(),
  };
  return Response.json(body, { status: dataWritable ? 200 : 503 });
}
