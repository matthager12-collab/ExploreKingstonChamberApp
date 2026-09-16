"use client";

// The Chamber's photo review list. Each row is one vote that came with a
// photo; "Remove" deletes the photo and the vote together (/api/admin/scarecrow).
//
// Photos load from /api/scarecrow/photo, which is admin-gated in its own
// handler — a route handler does not inherit the /admin layout's gate.

import { useState } from "react";

export interface CrawlPhoto {
  id: string;
  /** Already resolved to the scarecrow's name server-side. */
  label: string;
  when: string;
  src: string;
}

export function PhotoList({ photos }: { photos: CrawlPhoto[] }) {
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function remove(id: string) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch("/api/admin/scarecrow", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setError("That photo could not be removed. Try again.");
        return;
      }
      setRemoved((prev) => ({ ...prev, [id]: true }));
    } catch {
      setError("No connection — nothing was removed.");
    } finally {
      setBusy(null);
    }
  }

  if (photos.length === 0) {
    return <p className="text-ink-soft">No photos yet.</p>;
  }

  return (
    <>
      {error ? (
        <p className="mb-3 text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {photos.map((photo) => (
          <li key={photo.id} className="rounded-2xl border border-sand bg-white p-3">
            {removed[photo.id] ? (
              <p className="text-sm text-ink-soft">Removed.</p>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- admin-only
                    private stream, no-store: the image optimizer must not cache it. */}
                <img
                  src={photo.src}
                  alt={`Visitor photo for ${photo.label}`}
                  className="mb-2 w-full rounded-xl"
                />
                <p className="text-sm font-semibold text-ink">{photo.label}</p>
                <p className="text-xs text-ink-soft">{photo.when}</p>
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  disabled={busy === photo.id}
                  className="mt-2 inline-flex min-h-[44px] items-center rounded-full border border-sand px-4 py-2 text-sm font-semibold text-ink hover:bg-sand/30 disabled:opacity-50"
                >
                  {busy === photo.id ? "Removing…" : "Remove"}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
