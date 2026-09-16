"use client";

// Add and remove crawl entries without leaving the console.
//
// This writes through the EXISTING map-features admin API — the same endpoint
// the /admin/maps builder uses — because a crawl entry IS a marker on the
// crawl map view. No second store, no second set of rules, and anything added
// here can be dragged into place in the builder afterwards (and the other way
// round). The only thing this form adds is not having to learn the builder to
// put a business on the list.

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface EditableScarecrow {
  id: string;
  title: string;
  creator?: string;
  notes?: string;
  votes: number;
}

/** Where a new pin lands when no coordinates are given: downtown, to be
 *  dragged into place. Mirrors CRAWL_MAP_CENTER — passed in by the server so
 *  the client bundle does not import the data module. */
export interface CrawlEditorProps {
  scarecrows: EditableScarecrow[];
  viewId: string;
  defaultPoint: [number, number];
}

/** A map-feature id from a business name: lowercase, dashes, prefixed so a
 *  crawl entry can never collide with (and overwrite) a marker on another
 *  view. Falls back to a timestamp when the name has no usable characters. */
function featureId(title: string, taken: Set<string>): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `entry-${Date.now().toString(36)}`;
  let id = `scarecrow-${slug}`;
  let n = 2;
  while (taken.has(id)) id = `scarecrow-${slug}-${n++}`;
  return id;
}

export function CrawlEditor({ scarecrows, viewId, defaultPoint }: CrawlEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [notes, setNotes] = useState("");
  const [coords, setCoords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    setNote("");

    // "47.7981, -122.4960" pasted from a phone or Google Maps. Blank is fine:
    // the pin lands downtown and gets dragged into place in the map builder.
    let point = defaultPoint;
    const typed = coords.trim();
    if (typed) {
      const parts = typed.split(",").map((p) => Number(p.trim()));
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
        setError("Coordinates should look like: 47.7981, -122.4960");
        setBusy(false);
        return;
      }
      point = [parts[0], parts[1]];
    }

    try {
      const res = await fetch("/api/admin/map-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: featureId(title, new Set(scarecrows.map((s) => s.id))),
          kind: "marker",
          title: title.trim(),
          ...(creator.trim() ? { creator: creator.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          category: "event",
          views: [viewId],
          point,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "That could not be saved.");
        return;
      }
      setTitle("");
      setCreator("");
      setNotes("");
      setCoords("");
      setNote(
        typed
          ? "Added. The public page picks it up within a minute."
          : "Added at the middle of downtown — open the map builder to drag it onto the right spot.",
      );
      router.refresh();
    } catch {
      setError("No connection — nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove ${name} from the crawl? Votes already cast for it stay counted.`)) {
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/admin/map-features?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("That could not be removed.");
        return;
      }
      setNote("Removed. It disappears from the public page within a minute.");
      router.refresh();
    } catch {
      setError("No connection — nothing was removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="mb-6 space-y-2">
        {scarecrows.length === 0 ? (
          <li className="text-ink-soft">No entries yet. Add the first one below.</li>
        ) : (
          scarecrows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 text-ink">
              <span className="font-semibold">{s.title}</span>
              {s.creator ? <span>by {s.creator}</span> : null}
              {s.notes ? <span className="text-ink-soft">{s.notes}</span> : null}
              <span className="text-ink-soft">
                · {s.votes} {s.votes === 1 ? "vote" : "votes"}
              </span>
              <button
                type="button"
                onClick={() => remove(s.id, s.title)}
                disabled={busy}
                className="min-h-[44px] text-sm font-semibold text-ink underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={add} className="rounded-2xl border border-sand bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-ink">Add a scarecrow</h3>

        <label className="block text-sm font-semibold text-ink" htmlFor="crawl-title">
          Name
        </label>
        <input
          id="crawl-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Drifter's Gifts"
          className="mt-1 mb-3 block w-full rounded-xl border border-sand px-3 py-2 text-ink"
          required
        />

        <label className="block text-sm font-semibold text-ink" htmlFor="crawl-creator">
          Business or maker
        </label>
        <input
          id="crawl-creator"
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          placeholder="Kingston Cooperative Preschool"
          className="mt-1 mb-3 block w-full rounded-xl border border-sand px-3 py-2 text-ink"
        />
        <p className="-mt-2 mb-3 text-xs text-ink-soft">
          Who built it, or whose shop it stands outside. Shown as its own line on the page.
        </p>

        <label className="block text-sm font-semibold text-ink" htmlFor="crawl-notes">
          Line underneath (optional)
        </label>
        <input
          id="crawl-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="11225 NE State Hwy 104 — in the front window"
          className="mt-1 mb-3 block w-full rounded-xl border border-sand px-3 py-2 text-ink"
        />

        <label className="block text-sm font-semibold text-ink" htmlFor="crawl-coords">
          Coordinates (optional)
        </label>
        <input
          id="crawl-coords"
          value={coords}
          onChange={(e) => setCoords(e.target.value)}
          placeholder="47.7981, -122.4960"
          className="mt-1 block w-full rounded-xl border border-sand px-3 py-2 text-ink"
        />
        <p className="mt-1 text-xs text-ink-soft">
          Leave this blank and the pin lands in the middle of downtown — then drag it onto the right
          spot in the map builder. To copy coordinates: long-press the place in Google Maps.
        </p>

        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-sound px-5 py-2.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add to the crawl"}
        </button>

        {error ? (
          <p className="mt-3 text-sm text-ink" role="alert">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="mt-3 text-sm text-ink-soft" aria-live="polite">
            {note}
          </p>
        ) : null}
      </form>
    </>
  );
}
