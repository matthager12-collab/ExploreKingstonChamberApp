"use client";

// Itinerary builder for the Chamber admin (laptop-first), modeled on the
// hunt builder. Pick a seed or custom itinerary (or start fresh), edit the
// headline fields and the ordered stop list, and save. Saving POSTs the full
// record to /api/admin/content-records (domain=itineraries); the public
// /itineraries pages read the same overlay store.
//
// Deleting works on any record: custom records disappear outright, and seed
// records get a tombstone overlay that hides them from the site (they can be
// restored later by removing the overlay row) — the confirm dialog explains
// which case applies.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Itinerary } from "@/lib/types";
import { Badge, Card } from "@/components/ui";

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

type DraftStop = {
  /** client-only React key — stripped before save */
  key: string;
  time: string;
  title: string;
  description: string;
  mapQuery: string;
};

type Draft = {
  /** empty until the first save of a brand-new itinerary (derived from slug) */
  id: string;
  slug: string;
  /** once the admin edits the slug by hand, stop auto-suggesting from title */
  slugTouched: boolean;
  title: string;
  tagline: string;
  duration: string;
  mode: Itinerary["mode"];
  /** comma-separated audience tags, split on save */
  audienceText: string;
  stops: DraftStop[];
  isNew: boolean;
};

function genKey(): string {
  return `stop-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function newStop(): DraftStop {
  return { key: genKey(), time: "", title: "", description: "", mapQuery: "" };
}

function toDraft(it: Itinerary): Draft {
  return {
    id: it.id,
    slug: it.slug,
    slugTouched: true,
    title: it.title,
    tagline: it.tagline,
    duration: it.duration,
    mode: it.mode,
    audienceText: it.audience.join(", "),
    stops: it.stops.map((s) => ({
      key: genKey(),
      time: s.time,
      title: s.title,
      description: s.description,
      mapQuery: s.mapQuery ?? "",
    })),
    isNew: false,
  };
}

function newDraft(): Draft {
  return {
    id: "",
    slug: "",
    slugTouched: false,
    title: "",
    tagline: "",
    duration: "",
    mode: "either",
    audienceText: "",
    stops: [newStop()],
    isNew: true,
  };
}

/** Client-side mirror of the server's validation — friendlier errors, same rules. */
function buildRecord(draft: Draft): { record: Itinerary } | { error: string } {
  const slug = draft.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return {
      error: "Slug is required: lowercase letters, numbers, and dashes (e.g. beach-day).",
    };
  }
  if (!draft.title.trim()) return { error: "The itinerary needs a title." };
  if (draft.stops.length === 0) return { error: "Add at least one stop." };
  for (let i = 0; i < draft.stops.length; i++) {
    if (!draft.stops[i].title.trim()) return { error: `Stop ${i + 1} needs a title.` };
  }
  return {
    record: {
      id: draft.id || slug,
      slug,
      title: draft.title.trim(),
      tagline: draft.tagline.trim(),
      duration: draft.duration.trim(),
      mode: draft.mode,
      audience: draft.audienceText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      stops: draft.stops.map((s) => {
        const mapQuery = s.mapQuery.trim();
        return {
          time: s.time.trim(),
          title: s.title.trim(),
          description: s.description.trim(),
          ...(mapQuery ? { mapQuery } : {}),
        };
      }),
    },
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function ItineraryEditor({
  initialItineraries,
  seedIds,
}: {
  initialItineraries: Itinerary[];
  seedIds: string[];
}) {
  const router = useRouter();
  const [itineraries, setItineraries] = useState<Itinerary[]>(initialItineraries);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const isSeed = (id: string) => seedIds.includes(id);

  function selectItinerary(id: string) {
    const it = itineraries.find((i) => i.id === id);
    setDraft(it ? toDraft(it) : null);
    setMessage(null);
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  /** Title edits auto-suggest the slug on new records until slug is hand-edited. */
  function setTitle(title: string) {
    setDraft((d) => {
      if (!d) return d;
      const slug = d.isNew && !d.slugTouched ? slugify(title) : d.slug;
      return { ...d, title, slug };
    });
  }

  function patchStop(index: number, patch: Partial<DraftStop>) {
    setDraft((d) => {
      if (!d) return d;
      const stops = d.stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...d, stops };
    });
  }

  function moveStop(index: number, delta: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const target = index + delta;
      if (target < 0 || target >= d.stops.length) return d;
      const stops = [...d.stops];
      [stops[index], stops[target]] = [stops[target], stops[index]];
      return { ...d, stops };
    });
  }

  function removeStop(index: number) {
    setDraft((d) => (d ? { ...d, stops: d.stops.filter((_, i) => i !== index) } : d));
  }

  function addStop() {
    setDraft((d) => (d ? { ...d, stops: [...d.stops, newStop()] } : d));
  }

  async function save(current: Draft) {
    const built = buildRecord(current);
    if ("error" in built) {
      setMessage({ kind: "error", text: built.error });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/content-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "itineraries", record: built.record }),
      });
      const data = (await res.json()) as { ok?: boolean; record?: Itinerary; error?: string };
      if (!res.ok || !data.ok || !data.record) {
        setMessage({ kind: "error", text: data.error ?? "Could not save the itinerary." });
        return;
      }
      const saved = data.record;
      setItineraries((list) => {
        const idx = list.findIndex((i) => i.id === saved.id);
        if (idx >= 0) return list.map((i, n) => (n === idx ? saved : i));
        return [...list, saved];
      });
      setDraft(toDraft(saved));
      setMessage({ kind: "ok", text: `Saved — live at /itineraries/${saved.slug}` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(current: Draft) {
    if (!current.id || current.isNew) return;
    const confirmText = isSeed(current.id)
      ? `"${current.title}" is a built-in itinerary. Deleting writes a tombstone that hides it from the site — it isn't gone forever (an admin/developer can restore it by removing the overlay row). Hide it?`
      : `Delete "${current.title}"? It disappears from the site immediately.`;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/content-records?domain=itineraries&id=${encodeURIComponent(current.id)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage({ kind: "error", text: data.error ?? "Could not delete the itinerary." });
        return;
      }
      setItineraries((list) => list.filter((i) => i.id !== current.id));
      setDraft(null);
      setMessage({ kind: "ok", text: `Deleted "${current.title}".` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Picker */}
      <div className="flex flex-wrap items-center gap-2">
        {itineraries.map((it) => (
          <button
            key={it.id}
            onClick={() => selectItinerary(it.id)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
              draft?.id === it.id
                ? "border-sound bg-sound text-white"
                : "border-sand bg-white text-ink hover:border-tide"
            }`}
          >
            {it.title}
            <span className="ml-1.5 text-xs font-normal opacity-70">
              {isSeed(it.id) ? "seed" : "custom"}
            </span>
          </button>
        ))}
        <button
          onClick={() => {
            setDraft(newDraft());
            setMessage(null);
          }}
          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
            draft?.isNew
              ? "border-coral bg-coral text-white"
              : "border-coral bg-white text-coral-deep hover:bg-coral/10"
          }`}
        >
          + New itinerary
        </button>
      </div>

      {!draft ? (
        <Card>
          <p className="text-sm text-ink-soft">
            Pick an itinerary above to edit it, or start a new one. Editing a seed
            itinerary saves a custom copy that overrides it on the site.
          </p>
        </Card>
      ) : (
        <>
          {/* Headline fields */}
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title">
                <input
                  className={INPUT}
                  value={draft.title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="The Walk-On Wander"
                />
              </Field>
              <Field label="Slug (URL: /itineraries/…)">
                <input
                  className={INPUT}
                  value={draft.slug}
                  onChange={(e) => patchDraft({ slug: e.target.value, slugTouched: true })}
                  placeholder="walk-on-wander"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Tagline">
                  <textarea
                    className={INPUT}
                    rows={2}
                    value={draft.tagline}
                    onChange={(e) => patchDraft({ tagline: e.target.value })}
                    placeholder="One sentence selling the day."
                  />
                </Field>
              </div>
              <Field label="Duration (free text)">
                <input
                  className={INPUT}
                  value={draft.duration}
                  onChange={(e) => patchDraft({ duration: e.target.value })}
                  placeholder="About 5 hours"
                />
              </Field>
              <Field label="Mode">
                <select
                  className={INPUT}
                  value={draft.mode}
                  onChange={(e) =>
                    patchDraft({ mode: e.target.value as Itinerary["mode"] })
                  }
                >
                  <option value="walk-on">Walk-on (no car needed)</option>
                  <option value="car">Car (bring the car)</option>
                  <option value="either">Either (car optional)</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Audience tags (comma-separated)">
                  <input
                    className={INPUT}
                    value={draft.audienceText}
                    onChange={(e) => patchDraft({ audienceText: e.target.value })}
                    placeholder="Couples, Solo travelers, No car needed"
                  />
                </Field>
              </div>
            </div>
          </Card>

          {/* Stops */}
          {draft.stops.map((stop, i) => (
            <Card key={stop.key}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-sound-deep">
                  Stop {i + 1}
                  {stop.title ? `: ${stop.title}` : ""}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveStop(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    className="rounded-lg border border-sand px-2 py-1 text-sm text-ink hover:border-tide disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveStop(i, 1)}
                    disabled={i === draft.stops.length - 1}
                    title="Move down"
                    className="rounded-lg border border-sand px-2 py-1 text-sm text-ink hover:border-tide disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeStop(i)}
                    title="Remove stop"
                    className="rounded-lg border border-coral/40 px-2 py-1 text-sm text-coral-deep hover:bg-coral/10"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-[8rem_1fr]">
                <Field label="Time (free text)">
                  <input
                    className={INPUT}
                    value={stop.time}
                    onChange={(e) => patchStop(i, { time: e.target.value })}
                    placeholder="9:40 AM"
                  />
                </Field>
                <Field label="Stop title">
                  <input
                    className={INPUT}
                    value={stop.title}
                    onChange={(e) => patchStop(i, { title: e.target.value })}
                    placeholder="Walk off the ferry"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Description">
                    <textarea
                      className={INPUT}
                      rows={3}
                      value={stop.description}
                      onChange={(e) => patchStop(i, { description: e.target.value })}
                      placeholder="What happens here, why it's worth it, any practical tips."
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Map query (address or place name for the Map ↗ link — optional)">
                    <input
                      className={INPUT}
                      value={stop.mapQuery}
                      onChange={(e) => patchStop(i, { mapQuery: e.target.value })}
                      placeholder="Mike Wallace Park, Kingston, WA"
                    />
                  </Field>
                </div>
              </div>
            </Card>
          ))}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={addStop}
              className="rounded-full border border-sound bg-white px-4 py-2 text-sm font-semibold text-sound-deep hover:bg-sound hover:text-white"
            >
              + Add stop
            </button>
            <button
              onClick={() => void save(draft)}
              disabled={busy}
              className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep disabled:opacity-60"
            >
              {busy ? "Working…" : "Save itinerary"}
            </button>
            {!draft.isNew && (
              <>
                <a
                  href={`/itineraries/${draft.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                >
                  View live page ↗
                </a>
                <button
                  onClick={() => void remove(draft)}
                  disabled={busy}
                  className="rounded-full border border-coral/40 bg-white px-4 py-2 text-sm font-semibold text-coral-deep hover:bg-coral/10 disabled:opacity-60"
                >
                  {isSeed(draft.id) ? "Hide (delete seed)" : "Delete"}
                </button>
                {isSeed(draft.id) && (
                  <Badge tone="sand">Seed — deleting hides it, restorable</Badge>
                )}
              </>
            )}
            {message && (
              <p
                className={`text-sm font-medium ${
                  message.kind === "ok" ? "text-fern" : "text-coral-deep"
                }`}
              >
                {message.text}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
