"use client";

// The touch drag-pan lock every map shares.
//
// MapLibre enables dragPan by default, and enabling it (together with
// touchZoomRotate) puts `touch-action: none` on the canvas container. A
// full-width map is then a dead zone for vertical page swipes: a one-finger
// scroll that starts anywhere on the map pans the map instead of the page. On a
// phone the maps here are 380–500 px tall inside a `px-4` Section, so all that
// is left to scroll from is a 16 px gutter down each side.
//
// FeatureMap has gated this since the CMS maps shipped; ferry-vessel-map and
// sr104-traffic-map never did, which left /ferry and /line — the two pages
// someone sitting in the ferry line is most likely to open — hostile to scroll.
// Rather than a third copy of the pattern, all three now share this module, so
// the behaviour and the button copy cannot drift apart.
//
// The lock is deliberately touch-only: on a fine pointer, dragging never
// competes with scrolling, so desktop keeps direct panning with no extra tap.

import { useCallback, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

/** True on a device whose primary input is touch. Guarded for SSR and for
 *  jsdom, where matchMedia is frequently absent. */
function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export interface MapTouchLock {
  /** Whether the map is currently swallowing no swipes — render the overlay. */
  locked: boolean;
  /** Call once with a freshly constructed map: disables dragPan on touch. */
  applyTo: (map: MapLibreMap) => void;
  /** Hand panning back to the visitor (the overlay's onClick). */
  unlock: () => void;
}

export function useMapTouchLock(): MapTouchLock {
  const mapRef = useRef<MapLibreMap | null>(null);
  const [locked, setLocked] = useState(false);

  const applyTo = useCallback((map: MapLibreMap) => {
    mapRef.current = map;
    if (isCoarsePointer()) {
      map.dragPan.disable();
      setLocked(true);
    } else {
      setLocked(false);
    }
  }, []);

  const unlock = useCallback(() => {
    mapRef.current?.dragPan.enable();
    setLocked(false);
  }, []);

  return { locked, applyTo, unlock };
}

/** The "tap to take control" affordance. Covers the map so the first touch is
 *  always the unlock rather than a pan the visitor did not ask for; the parent
 *  must be `relative`. Rendered only while `locked`, i.e. only on touch. */
export function MapTouchLockOverlay({ onUnlock }: { onUnlock: () => void }) {
  return (
    <button
      type="button"
      onClick={onUnlock}
      className="absolute inset-0 z-[450] flex items-end justify-center rounded-2xl bg-transparent pb-4"
      aria-label="Tap to interact with the map"
    >
      <span className="rounded-full bg-sound-deep/85 px-4 py-2 text-sm font-semibold text-white shadow">
        Tap to explore the map
      </span>
    </button>
  );
}
