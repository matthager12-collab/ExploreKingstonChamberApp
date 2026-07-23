// Client-only helper: dynamically load terra-draw and its MapLibre adapter for
// the admin map editors (E32). Like maplibre.ts, the browser-flavoured
// libraries are imported here — never at module scope in a shared file — so
// nothing server-side pulls them in.

import type { IdStrategy, TerraDrawExtend } from "terra-draw";

/** Load the terra-draw namespace and the MapLibre adapter class together. */
export async function loadTerraDraw() {
  const [terraDraw, adapter] = await Promise.all([
    import("terra-draw"),
    import("terra-draw-maplibre-gl-adapter"),
  ]);
  return { terraDraw, TerraDrawMapLibreGLAdapter: adapter.TerraDrawMapLibreGLAdapter };
}

/**
 * Terra-draw's default id strategy only mints and accepts UUIDs. The app's
 * feature ids are short human-readable strings ("zone-x7k2p1", seed ids), and
 * the editors reuse them as draw-store ids so selection and save read straight
 * across — so accept any non-empty string. Ids for newly drawn shapes are
 * still UUIDs.
 */
export function editorIdStrategy(): IdStrategy<TerraDrawExtend.FeatureId> {
  return {
    getId: () => crypto.randomUUID(),
    isValidId: (id) => typeof id === "string" && id.length > 0,
  };
}
