// MapLibre's Marker.addTo() stamps `aria-label="Map marker"` onto the marker
// element AFTER construction, overwriting anything set earlier (maplibre-gl
// 4.7.1, Marker.addTo). Our markers are custom <div> elements with no role,
// and ARIA prohibits aria-label on a role-less div — so every custom marker
// failed axe's aria-prohibited-attr (serious). Found by the 2026-08 launch
// sweep on /map and /eat; the same markers render on /parking, /ferry and
// /line once their lazy maps scroll into view.
//
// Call this AFTER .addTo(map) — order matters, addTo() is the clobberer.
//   name given -> role="img" + that name: pins a screen reader should hear
//                 (role img permits aria-label, and the name beats the
//                 useless default "Map marker").
//   name null  -> removed from the accessibility tree: label chips that only
//                 repeat what an adjacent named pin already announces.
export function fixMarkerA11y(
  marker: { getElement(): HTMLElement },
  name: string | null,
): void {
  const el = marker.getElement();
  if (name) {
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", name);
  } else {
    el.removeAttribute("aria-label");
    el.setAttribute("aria-hidden", "true");
  }
}
