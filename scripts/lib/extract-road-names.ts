// Extract every label-eligible road name from a PMTiles basemap archive.
//
// Shared by scripts/derive-street-abbrevs.ts (regenerates the checked-in
// abbreviation table) and the drift-guard test (tests/unit/map/
// street-abbrev-drift.test.ts, which fails when the archive gains a name the
// table lacks). Eligibility mirrors the label layers exactly by importing
// LABELED_ROAD_KINDS from basemap.ts — ferry/rail names ("Edmonds - Kingston
// Ferry") never enter the table because those kinds are never labeled.
//
// Decoding: PMTiles is an indexed archive of gzip-compressed MVT tiles; the
// `pmtiles` lib handles the index + decompression and @mapbox/vector-tile +
// pbf decode each tile's `roads` layer. The whole Kingston archive is ~1.8 MB
// so this just loads it into memory and walks every tile in the header's
// bbox at every zoom the archive carries (names appear from z12 tiles; the
// loop stays generic in case a future build shifts the data floor).

import { readFile } from "node:fs/promises";

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { PMTiles, type Source, type RangeResponse } from "pmtiles";

import { LABELED_ROAD_KINDS } from "../../src/lib/map/basemap";

class BufferSource implements Source {
  constructor(private buf: Buffer) {}
  getKey(): string {
    return "in-memory";
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    // Copy into a fresh ArrayBuffer: Buffer.buffer is typed ArrayBufferLike
    // (possibly a pooled slab), and RangeResponse wants a plain ArrayBuffer.
    const view = this.buf.subarray(offset, offset + length);
    const data = new ArrayBuffer(view.byteLength);
    new Uint8Array(data).set(view);
    return { data };
  }
}

const lon2tile = (lon: number, z: number): number =>
  Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat: number, z: number): number =>
  Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      2 ** z,
  );

/** Distinct names of label-eligible roads across the whole archive, sorted. */
export async function extractLabeledRoadNames(pmtilesPath: string): Promise<string[]> {
  const archive = new PMTiles(new BufferSource(await readFile(pmtilesPath)));
  const header = await archive.getHeader();
  const eligible = new Set<string>(LABELED_ROAD_KINDS);
  const names = new Set<string>();

  for (let z = header.minZoom; z <= header.maxZoom; z++) {
    const x0 = lon2tile(header.minLon, z);
    const x1 = lon2tile(header.maxLon, z);
    const y0 = lat2tile(header.maxLat, z);
    const y1 = lat2tile(header.minLat, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const tile = await archive.getZxy(z, x, y);
        if (!tile?.data) continue;
        const roads = new VectorTile(new Pbf(new Uint8Array(tile.data))).layers["roads"];
        if (!roads) continue;
        for (let i = 0; i < roads.length; i++) {
          const props = roads.feature(i).properties as {
            kind?: unknown;
            name?: unknown;
          };
          if (typeof props.name !== "string" || props.name.length === 0) continue;
          if (typeof props.kind !== "string" || !eligible.has(props.kind)) continue;
          names.add(props.name);
        }
      }
    }
  }
  return [...names].sort();
}
