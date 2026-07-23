// Public proxy for the self-hosted vector basemap PMTiles (E31 Phase 2, ADR-0006).
//
// R2 is private (no public URL is possible here — see tiles-store.ts), so this
// route forwards the client's `Range` header to the private tiles bucket and
// passes R2's `206 Partial Content` straight back. It mirrors the image proxy
// (src/app/api/map/image/route.ts) but is PUBLIC by design: the payload is
// OSM-derived basemap tiles, never user data. MapLibre + the pmtiles:// protocol
// point at `/api/map/tiles/kingston.pmtiles`.

import { NextRequest } from "next/server";
import { getTileObject, isValidTileKey } from "@/lib/map/tiles-store";

// A range proxy must never be cached or prerendered: this Next version does not
// cache GET Route Handlers by default, but reading the Range header makes this
// request-time anyway — force-dynamic states the intent and forecloses any
// future Cache-Components prerender attempt.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!isValidTileKey(file)) {
    return new Response("not found", { status: 404 });
  }

  const range = req.headers.get("range") ?? undefined;

  let tile;
  try {
    tile = await getTileObject(file, range);
  } catch {
    // Misconfiguration or an upstream R2 error must not take a page down.
    return new Response("tiles unavailable", { status: 502 });
  }
  if (!tile) return new Response("not found", { status: 404 });

  return new Response(tile.body, { status: tile.status, headers: tile.headers });
}
