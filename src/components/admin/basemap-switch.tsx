"use client";

// Map ⟷ Imagery base switch for the ADMIN map editors (E32 zone editor and
// map builder).
//
// The public site no longer offers the Esri base at all (ADR-0006 amendment
// 2): its keyless ceiling over Kingston is native z19, which smears cars into
// blobs at the zooms parking actually needs, so the Chamber withdrew it from
// /parking until better imagery is licensed (the Kitsap County ~0.10 m HXIP
// orthos are the identified upgrade path). The EDITORS keep it because
// tracing a curb or a lot boundary against even soft imagery beats tracing
// against abstract vector shapes — an admin tolerates quality a visitor
// shouldn't be handed — and both editors cap at z18, under Esri's native
// ceiling, so they never render overzoomed mush.
//
// Every mapStyle() instance already carries the satellite source/layer
// hidden (zero requests until shown — see basemap.ts); this switch only
// flips applyBasemapMode, and MapLibre's attribution control surfaces the
// Esri credit automatically while imagery is visible.

import { useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { applyBasemapMode, type BasemapMode } from "@/lib/map/basemap";

const active =
  "rounded-full bg-sound px-3 py-1 text-xs font-semibold text-white";
const idle =
  "rounded-full border border-sand bg-white px-3 py-1 text-xs font-semibold text-tide-deep hover:border-tide";

export function BasemapSwitch({ getMap }: { getMap: () => MapLibreMap | null }) {
  const [mode, setMode] = useState<BasemapMode>("map");

  const pick = (next: BasemapMode) => {
    const map = getMap();
    if (!map || next === mode) return;
    applyBasemapMode(map, next);
    setMode(next);
  };

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Base layer">
      <span className="text-xs font-medium text-ink-soft">Base:</span>
      <button type="button" onClick={() => pick("map")} className={mode === "map" ? active : idle} aria-pressed={mode === "map"}>
        Map
      </button>
      <button
        type="button"
        onClick={() => pick("satellite")}
        className={mode === "satellite" ? active : idle}
        aria-pressed={mode === "satellite"}
      >
        Imagery
      </button>
    </div>
  );
}
