import type { Map, Popup } from "maplibre-gl";

/** Keep the existing escaped popup builders reachable inside small map viewports. */
export function mapPopup(
  maplibre: { Popup: typeof Popup },
  map: Map,
  html: string,
  offset: [number, number] = [0, 0],
): Popup {
  const popup = new maplibre.Popup({ anchor: "bottom", offset, maxWidth: "240px" })
    .setHTML(`<div class="fm-popup-body" tabindex="0" role="region" aria-label="Map details">${html}</div>`);
  let openElement: HTMLElement | undefined;

  const fit = () => {
    const element = popup.getElement();
    const body = element.querySelector<HTMLElement>(".fm-popup-body")!;
    const container = map.getContainer();
    // Reserve the marker offset, popup padding/tip and map gutters.
    body.style.maxHeight = `${Math.max(1, container.clientHeight - 100)}px`;
    body.style.overflowY = "auto";
    body.style.overflowWrap = "anywhere";
    popup.setMaxWidth(`${Math.max(1, Math.min(240, container.clientWidth - 24))}px`);

    const bounds = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const x = rect.left < bounds.left + 12
      ? rect.left - bounds.left - 12
      : Math.max(0, rect.right - bounds.right + 12);
    const y = rect.top < bounds.top + 12
      ? rect.top - bounds.top - 12
      : Math.max(0, rect.bottom - bounds.bottom + 12);
    if (x || y) map.panBy([x, y], { duration: 0 });
  };

  popup.on("open", () => {
    openElement = popup.getElement();
    map.on("resize", fit);
    openElement.addEventListener("load", fit, true);
    fit();
  });
  popup.on("close", () => {
    map.off("resize", fit);
    openElement?.removeEventListener("load", fit, true);
    openElement = undefined;
  });
  return popup;
}
