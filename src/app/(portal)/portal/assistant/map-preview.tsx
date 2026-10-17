"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { basemapArchiveUrl, loadMapLibre } from "@/lib/map/maplibre";
import { mapStyle } from "@/lib/map/basemap";
import { mapDraftSchema } from "@/lib/research/schema";
export function DraftMapPreview({
  title,
  body,
  data,
}: {
  title: string;
  body: string;
  data: Record<string, unknown>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const parsed = mapDraftSchema.safeParse({ ...data, title, notes: body });
    if (!parsed.success) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    loadMapLibre()
      .then((gl) => {
        if (disposed || !container.current) return;
        const feature = parsed.data;
        const points =
          feature.kind === "marker"
            ? [feature.point!]
            : feature.kind === "area"
              ? feature.polygon!
              : feature.path!;
        const coords = points.map(
          ([lat, lng]) => [lng, lat] as [number, number],
        );
        map = new gl.Map({
          container: container.current,
          style: mapStyle(basemapArchiveUrl()),
          center: coords[0],
          zoom: 14,
          scrollZoom: false,
        });
        map.addControl(new gl.NavigationControl({ showCompass: false }));
        map.on("error", () =>
          setError(
            "Map background could not load. Check the coordinates with the link below.",
          ),
        );
        map.on("load", () => {
          if (disposed || !map) return;
          if (feature.kind === "marker")
            new gl.Marker().setLngLat(coords[0]).addTo(map);
          else {
            const geometry: GeoJSON.Geometry =
              feature.kind === "area"
                ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
                : { type: "LineString", coordinates: coords };
            map.addSource("draft", {
              type: "geojson",
              data: { type: "Feature", geometry, properties: {} },
            });
            if (feature.kind === "area")
              map.addLayer({
                id: "draft-fill",
                source: "draft",
                type: "fill",
                paint: { "fill-color": "#16758f", "fill-opacity": 0.25 },
              });
            map.addLayer({
              id: "draft-line",
              source: "draft",
              type: "line",
              paint: { "line-color": "#16758f", "line-width": 4 },
            });
            const bounds = new gl.LngLatBounds(coords[0], coords[0]);
            coords.forEach((c) => bounds.extend(c));
            map.fitBounds(bounds, { padding: 35, maxZoom: 15 });
          }
        });
      })
      .catch(() =>
        setError("Map preview is unavailable. Use the coordinate link below."),
      );
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [title, body, data]);
  if (!mapDraftSchema.safeParse({ ...data, title, notes: body }).success)
    return (
      <p className="mt-3 text-sm text-ink-soft">
        Map preview will appear once the location and map are confirmed.
      </p>
    );
  return (
    <div className="mt-3">
      <div
        ref={container}
        role="region"
        aria-label={`Draft map preview: ${title}`}
        className="h-64 overflow-hidden rounded-lg border border-border"
      />
      {error && (
        <p role="status" className="text-sm text-ink-soft">
          {error}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-soft">
        Draft preview — not yet published.
      </p>
    </div>
  );
}
