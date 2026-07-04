// Live ferry status for client-side refresh (the home Next-Ferries widget and
// the /ferry board poll this). Assembly lives in lib/ferry-status so the
// server-rendered initial state and the polled updates share one shape.

import { getFerryStatusSnapshot } from "@/lib/ferry-status";

export async function GET() {
  return Response.json(await getFerryStatusSnapshot());
}
