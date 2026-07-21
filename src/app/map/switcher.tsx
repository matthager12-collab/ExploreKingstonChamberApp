"use client";

// Client-side view switcher for /map. FeatureMap is a client component and the
// selection needs local state, so this thin wrapper owns the pill buttons and
// swaps which view FeatureMap renders.

import { useState } from "react";
import { FeatureMap } from "@/components/feature-map";
import { EditableText } from "@/lib/copy-context";

interface SwitcherView {
  id: string;
  name: string;
  description?: string;
}

export function MapSwitcher({ views }: { views: SwitcherView[] }) {
  const [selected, setSelected] = useState(views[0]?.id ?? "");
  const active = views.find((v) => v.id === selected);

  if (views.length === 0) {
    return (
      <EditableText
        as="p"
        className="text-ink-soft"
        copyKey="mapswitcher.empty"/>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setSelected(v.id)}
            aria-pressed={v.id === selected}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              v.id === selected
                ? "bg-sound text-white"
                : "border border-sand bg-white text-sound-deep hover:bg-shell"
            }`}
          >
            {v.name}
          </button>
        ))}
      </div>

      <FeatureMap view={selected} height="min(70vh,560px)" />

      {active?.description && (
        <p className="mt-3 max-w-2xl text-ink">{active.description}</p>
      )}
    </div>
  );
}
