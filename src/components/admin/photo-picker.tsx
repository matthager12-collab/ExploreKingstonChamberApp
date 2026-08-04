"use client";

// A reusable "pick photos from the shared library" control for admin editors.
//
// Extracted as its own component rather than written inline because a SECOND
// surface now needs it (parking zones, alongside listing photos), and the
// codebase already carries one cautionary tale about the alternative — see the
// "Two divergent parking color maps" note in docs/MAPS.md, a copy-paste
// dependency kept in sync by hand across three files.
//
// DEBT, recorded on purpose: record-editor.tsx still has its own inline copy of
// this UI for listing photos. It was left alone deliberately — this landed days
// before launch and listing photos are live in production, so migrating it is a
// post-launch refactor with a real regression surface and no visitor-visible
// gain. When that happens, this file is the destination.

import { useState } from "react";
import { mediaUrl, type MediaItem } from "@/lib/media/refs";

export function PhotoPicker({
  value,
  library,
  onChange,
  emptyHint = "No photos in the library yet. Add some under Photos, then come back and they'll be selectable here.",
}: {
  /** Chosen library names, in display order. */
  value: string[];
  library: MediaItem[];
  onChange: (next: string[]) => void;
  emptyHint?: string;
}) {
  const [picking, setPicking] = useState(false);
  const byId = new Map(library.map((m) => [m.id, m]));

  if (library.length === 0) {
    return <p className="text-sm text-ink-soft">{emptyHint}</p>;
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {value.map((name, i) => {
            const item = byId.get(name);
            return (
              <li key={name} className="w-32">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin
                    thumbnail of an arbitrary-dimension photo; next/image needs
                    width/height the library does not store. */}
                <img
                  src={mediaUrl(name)}
                  alt=""
                  className="h-20 w-32 rounded border border-sand object-cover"
                  loading="lazy"
                />
                <p className="truncate text-xs text-ink-soft">{item?.title ?? name}</p>
                {/* The gap the alt-text fallback papers over. Surfacing it here
                    is the ONLY thing that gets it fixed — once a photo renders,
                    a fallback alt is indistinguishable from a written one. */}
                {item && !item.alt.trim() && (
                  <p className="text-xs text-coral-deep">Needs a description</p>
                )}
                <div className="flex gap-1 pt-1">
                  {i > 0 && (
                    <button
                      type="button"
                      className="text-xs font-semibold underline"
                      onClick={() => onChange([name, ...value.filter((n) => n !== name)])}
                    >
                      Make first
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs font-semibold underline"
                    onClick={() => onChange(value.filter((n) => n !== name))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="min-h-[44px] rounded-full bg-sand px-4 py-2 text-sm font-semibold text-ink"
        onClick={() => setPicking((p) => !p)}
      >
        {picking ? "Close" : value.length ? "Add another photo" : "Add a photo"}
      </button>
      {picking && (
        <ul className="grid grid-cols-4 gap-2 border-t border-sand pt-3 sm:grid-cols-6">
          {library.map((item) => {
            const chosen = value.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  className="block w-full text-left"
                  onClick={() =>
                    onChange(
                      chosen ? value.filter((n) => n !== item.id) : [...value, item.id],
                    )
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img
                    src={mediaUrl(item.id)}
                    alt=""
                    className={`h-14 w-full rounded object-cover ${
                      chosen ? "ring-2 ring-tide-deep" : "border border-sand"
                    }`}
                    loading="lazy"
                  />
                  <span className="mt-1 block truncate text-xs text-ink-soft">
                    {chosen ? "✓ " : ""}
                    {item.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
