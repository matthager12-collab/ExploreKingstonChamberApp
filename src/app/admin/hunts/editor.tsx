"use client";

// Hunt builder for the Chamber admin (laptop-first). Pick a seed or custom
// hunt (or start fresh), edit fields and stops, attach a reference photo per
// stop, and review player submissions beside that reference photo.
//
// Saving POSTs the full hunt JSON to /api/hunts; reference photos POST to
// /api/hunts/reference (the draft is auto-saved first so the server knows the
// stop). Numeric fields are edited as strings and validated on save so typing
// "47." or "-" never fights the input.

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AdminHunt, HuntSubmission } from "@/lib/hunt-store"; // type-only: safe in a client file
import { Badge, Card } from "@/components/ui";
import { Provenance } from "@/components/admin/provenance";
import { RecordHistory } from "@/components/admin/record-history";

type SubmissionWithUrl = HuntSubmission & { photoUrl: string };

type DraftStop = {
  id: string;
  title: string;
  clue: string;
  hint: string;
  photoPrompt: string;
  funFact: string;
  lat: string;
  lng: string;
  radiusMeters: string;
  referencePhoto?: string;
};

type DraftHunt = {
  /** empty until the first save of a brand-new hunt (derived from slug) */
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "moderate";
  durationMinutes: string;
  stops: DraftStop[];
  source: "seed" | "custom" | "new";
};

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

function photoSrc(relPath: string, version?: number): string {
  return `/api/hunts/photo?p=${encodeURIComponent(relPath)}${version ? `&v=${version}` : ""}`;
}

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function newStop(): DraftStop {
  return {
    id: genId("stop"),
    title: "",
    clue: "",
    hint: "",
    photoPrompt: "",
    funFact: "",
    // Downtown Kingston as a starting point — nudge with the Maps link below.
    lat: "47.7960",
    lng: "-122.4960",
    radiusMeters: "100",
  };
}

function toDraft(hunt: AdminHunt): DraftHunt {
  return {
    id: hunt.id,
    slug: hunt.slug,
    title: hunt.title,
    description: hunt.description,
    difficulty: hunt.difficulty,
    durationMinutes: String(hunt.durationMinutes),
    stops: hunt.stops.map((s) => ({
      id: s.id,
      title: s.title,
      clue: s.clue,
      hint: s.hint,
      photoPrompt: s.photoPrompt,
      funFact: s.funFact,
      lat: String(s.lat),
      lng: String(s.lng),
      radiusMeters: String(s.radiusMeters),
      referencePhoto: s.referencePhoto,
    })),
    source: hunt.source,
  };
}

function newDraft(): DraftHunt {
  return {
    id: "",
    slug: "",
    title: "",
    description: "",
    difficulty: "easy",
    durationMinutes: "45",
    stops: [newStop()],
    source: "new",
  };
}

/** Client-side mirror of the server's validation — friendlier errors, same rules. */
function buildPayload(draft: DraftHunt): { hunt: Record<string, unknown> } | { error: string } {
  const slug = draft.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return { error: "Slug is required: lowercase letters, numbers, and dashes (e.g. pier-prowl)." };
  }
  if (!draft.title.trim()) return { error: "The hunt needs a title." };
  if (draft.stops.length === 0) return { error: "Add at least one stop." };

  const stops = [];
  for (let i = 0; i < draft.stops.length; i++) {
    const s = draft.stops[i];
    if (!s.title.trim()) return { error: `Stop ${i + 1} needs a title.` };
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { error: `Stop ${i + 1}: latitude must be a number between -90 and 90.` };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { error: `Stop ${i + 1}: longitude must be a number between -180 and 180.` };
    }
    const radiusMeters = Math.round(Number(s.radiusMeters));
    if (!Number.isFinite(radiusMeters) || radiusMeters < 20 || radiusMeters > 1000) {
      return { error: `Stop ${i + 1}: radius must be 20–1000 meters.` };
    }
    stops.push({
      id: s.id,
      title: s.title.trim(),
      clue: s.clue.trim(),
      hint: s.hint.trim(),
      photoPrompt: s.photoPrompt.trim(),
      funFact: s.funFact.trim(),
      lat,
      lng,
      radiusMeters,
      ...(s.referencePhoto ? { referencePhoto: s.referencePhoto } : {}),
    });
  }

  const durationMinutes = Math.round(Number(draft.durationMinutes));
  return {
    hunt: {
      id: draft.id || slug,
      slug,
      title: draft.title.trim(),
      description: draft.description.trim(),
      difficulty: draft.difficulty,
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 45,
      stops,
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

export function HuntEditor({
  initialHunts,
  initialSelectedId,
}: {
  initialHunts: AdminHunt[];
  initialSelectedId?: string;
}) {
  const router = useRouter();
  const [hunts, setHunts] = useState<AdminHunt[]>(initialHunts);
  const [draft, setDraft] = useState<DraftHunt | null>(() => {
    const preselected = initialHunts.find((h) => h.id === initialSelectedId);
    return preselected ? toDraft(preselected) : null;
  });
  const [saving, setSaving] = useState(false);
  const [uploadingStopId, setUploadingStopId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithUrl[]>([]);
  const [refVersions, setRefVersions] = useState<Record<string, number>>({});

  const savedHuntId = draft && draft.source !== "new" ? draft.id : undefined;

  useEffect(() => {
    if (!savedHuntId) return; // cleared in selectHunt / "new hunt" handlers
    let cancelled = false;
    fetch(`/api/hunts?submissions=${encodeURIComponent(savedHuntId)}`)
      .then((res) => res.json())
      .then((data: { submissions?: SubmissionWithUrl[] }) => {
        if (!cancelled) setSubmissions(data.submissions ?? []);
      })
      .catch(() => {
        if (!cancelled) setSubmissions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [savedHuntId]);

  function selectHunt(id: string) {
    const hunt = hunts.find((h) => h.id === id);
    if (draft?.id !== id) setSubmissions([]); // refetched by the effect above
    setDraft(hunt ? toDraft(hunt) : null);
    setMessage(null);
  }

  function patchDraft(patch: Partial<DraftHunt>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
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

  /** Save the draft. Returns the saved hunt id, or null when invalid/failed. */
  async function save(current: DraftHunt): Promise<string | null> {
    const payload = buildPayload(current);
    if ("error" in payload) {
      setMessage({ kind: "error", text: payload.error });
      return null;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/hunts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.hunt),
      });
      const data = (await res.json()) as { ok?: boolean; hunt?: AdminHunt; error?: string };
      if (!res.ok || !data.ok || !data.hunt) {
        setMessage({ kind: "error", text: data.error ?? "Could not save the hunt." });
        return null;
      }
      const saved: AdminHunt = { ...data.hunt, source: "custom" };
      setHunts((list) => {
        const idx = list.findIndex((h) => h.id === saved.id);
        if (idx >= 0) return list.map((h, i) => (i === idx ? saved : h));
        return [...list, saved];
      });
      setDraft(toDraft(saved));
      setMessage({ kind: "ok", text: `Saved — live at /hunt/${saved.slug}` });
      router.refresh(); // update the server-rendered hunt list above
      return saved.id;
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — is the app running?" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function uploadReference(stopIndex: number, file: File) {
    if (!draft) return;
    const stop = draft.stops[stopIndex];
    setUploadingStopId(stop.id);
    try {
      // The server attaches the photo to the stored hunt record, so make sure
      // the draft (including this stop) exists server-side first.
      const huntId = await save(draft);
      if (!huntId) return;
      const body = new FormData();
      body.append("photo", file);
      body.append("huntId", huntId);
      body.append("stopId", stop.id);
      const res = await fetch("/api/hunts/reference", { method: "POST", body });
      const data = (await res.json()) as { ok?: boolean; referencePhoto?: string; error?: string };
      if (!res.ok || !data.ok || !data.referencePhoto) {
        setMessage({ kind: "error", text: data.error ?? "Could not upload the reference photo." });
        return;
      }
      patchStop(stopIndex, { referencePhoto: data.referencePhoto });
      setRefVersions((v) => ({ ...v, [stop.id]: (v[stop.id] ?? 0) + 1 }));
      setHunts((list) =>
        list.map((h) =>
          h.id === huntId
            ? {
                ...h,
                stops: h.stops.map((s) =>
                  s.id === stop.id ? { ...s, referencePhoto: data.referencePhoto } : s,
                ),
              }
            : h,
        ),
      );
      setMessage({ kind: "ok", text: `Reference photo saved for "${stop.title || stop.id}".` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Reference photo upload failed — try again." });
    } finally {
      setUploadingStopId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Picker */}
      <div className="flex flex-wrap items-center gap-2">
        {hunts.map((hunt) => (
          <button
            key={hunt.id}
            onClick={() => selectHunt(hunt.id)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
              draft?.id === hunt.id
                ? "border-sound bg-sound text-white"
                : "border-sand bg-white text-ink hover:border-tide"
            }`}
          >
            {hunt.title}
            <span className="ml-1.5 text-xs font-normal opacity-70">
              {hunt.source === "custom" ? "custom" : "seed"}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setDraft(newDraft());
            setSubmissions([]);
            setMessage(null);
          }}
          aria-pressed={draft?.source === "new"}
          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
            draft?.source === "new"
              ? "border-coral bg-coral text-white"
              : "border-coral bg-white text-coral-deep hover:bg-coral/10"
          }`}
        >
          + New hunt
        </button>
      </div>

      {!draft ? (
        <Card>
          <p className="text-sm text-ink-soft">
            Pick a hunt above to edit it, or start a new one. Editing a seed hunt saves a custom
            copy that overrides it for players.
          </p>
        </Card>
      ) : (
        <>
          {/* E09: provenance + change history for the saved hunt. Keyed so
              switching hunts remounts (see record-history.tsx). */}
          {savedHuntId && (
            <div className="space-y-2">
              <Provenance
                key={`p:${savedHuntId}`}
                store="custom-hunts"
                recordId={savedHuntId}
              />
              <RecordHistory
                key={`h:${savedHuntId}`}
                store="custom-hunts"
                recordId={savedHuntId}
              />
            </div>
          )}

          {/* Hunt fields */}
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title">
                <input
                  className={INPUT}
                  value={draft.title}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  placeholder="Pier & Pastry Prowl"
                />
              </Field>
              <Field label="Slug (URL: /hunt/…)">
                <input
                  className={INPUT}
                  value={draft.slug}
                  onChange={(e) => patchDraft({ slug: e.target.value })}
                  placeholder="pier-pastry-prowl"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description">
                  <textarea
                    className={INPUT}
                    rows={2}
                    value={draft.description}
                    onChange={(e) => patchDraft({ description: e.target.value })}
                    placeholder="What players are in for — terrain, vibe, who it's good for."
                  />
                </Field>
              </div>
              <Field label="Difficulty">
                <select
                  className={INPUT}
                  value={draft.difficulty}
                  onChange={(e) =>
                    patchDraft({ difficulty: e.target.value === "moderate" ? "moderate" : "easy" })
                  }
                >
                  <option value="easy">Easy</option>
                  <option value="moderate">Moderate</option>
                </select>
              </Field>
              <Field label="Duration (minutes)">
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={draft.durationMinutes}
                  onChange={(e) => patchDraft({ durationMinutes: e.target.value })}
                />
              </Field>
            </div>
          </Card>

          {/* Stops */}
          {draft.stops.map((stop, i) => {
            const stopSubs = submissions.filter((s) => s.stopId === stop.id);
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
            return (
              <Card key={stop.id}>
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

                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  {/* Left: text + coordinates */}
                  <div className="space-y-3">
                    <Field label="Stop title">
                      <input
                        className={INPUT}
                        value={stop.title}
                        onChange={(e) => patchStop(i, { title: e.target.value })}
                      />
                    </Field>
                    <Field label="Clue (the riddle players read)">
                      <textarea
                        className={INPUT}
                        rows={2}
                        value={stop.clue}
                        onChange={(e) => patchStop(i, { clue: e.target.value })}
                      />
                    </Field>
                    <Field label="Hint (shown on request)">
                      <textarea
                        className={INPUT}
                        rows={2}
                        value={stop.hint}
                        onChange={(e) => patchStop(i, { hint: e.target.value })}
                      />
                    </Field>
                    <Field label="Photo prompt">
                      <input
                        className={INPUT}
                        value={stop.photoPrompt}
                        onChange={(e) => patchStop(i, { photoPrompt: e.target.value })}
                        placeholder="Selfie with the ferry behind you"
                      />
                    </Field>
                    <Field label="Fun fact (revealed after check-off)">
                      <textarea
                        className={INPUT}
                        rows={2}
                        value={stop.funFact}
                        onChange={(e) => patchStop(i, { funFact: e.target.value })}
                      />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Latitude">
                        <input
                          className={INPUT}
                          inputMode="decimal"
                          value={stop.lat}
                          onChange={(e) => patchStop(i, { lat: e.target.value })}
                        />
                      </Field>
                      <Field label="Longitude">
                        <input
                          className={INPUT}
                          inputMode="decimal"
                          value={stop.lng}
                          onChange={(e) => patchStop(i, { lng: e.target.value })}
                        />
                      </Field>
                      <Field label="Radius (m)">
                        <input
                          className={INPUT}
                          inputMode="numeric"
                          value={stop.radiusMeters}
                          onChange={(e) => patchStop(i, { radiusMeters: e.target.value })}
                        />
                      </Field>
                    </div>
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                    >
                      Check the spot in Google Maps ↗
                    </a>
                  </div>

                  {/* Right: reference photo + player submissions */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        Reference photo — what the spot looks like
                      </p>
                      {stop.referencePhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element -- served by our local photo API
                        <img
                          src={photoSrc(stop.referencePhoto, refVersions[stop.id])}
                          alt={`Reference for ${stop.title || `stop ${i + 1}`}`}
                          className="mt-2 max-h-48 w-full rounded-xl border border-sand object-cover"
                        />
                      ) : (
                        <p className="mt-2 rounded-xl border border-dashed border-sand p-4 text-center text-sm text-ink-soft">
                          No reference photo yet — players will only get the clue.
                        </p>
                      )}
                      <label className="mt-2 inline-block cursor-pointer rounded-full border border-tide bg-white px-4 py-1.5 text-sm font-semibold text-tide-deep hover:bg-tide hover:text-white">
                        {uploadingStopId === stop.id
                          ? "Uploading…"
                          : stop.referencePhoto
                            ? "Replace photo"
                            : "Upload photo"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic"
                          className="hidden"
                          disabled={uploadingStopId !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void uploadReference(i, file);
                          }}
                        />
                      </label>
                      <p className="mt-1 text-xs text-ink-soft">
                        Uploading also saves the hunt. JPEG/PNG/WebP/HEIC, max 8 MB.
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-ink">
                        Player submissions{" "}
                        <span className="font-normal text-ink-soft">({stopSubs.length})</span>
                      </p>
                      {stopSubs.length === 0 ? (
                        <p className="mt-1 text-xs text-ink-soft">
                          Nothing posted for this stop yet.
                        </p>
                      ) : (
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {stopSubs.map((sub) => (
                            <div key={sub.photoPath} className="rounded-lg border border-sand p-1.5">
                              {/* eslint-disable-next-line @next/next/no-img-element -- served by our local photo API */}
                              <img
                                src={sub.photoUrl}
                                alt={`Player photo, ${new Date(sub.ts).toLocaleString()}`}
                                className="h-20 w-full rounded-md object-cover"
                              />
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {sub.verified ? (
                                  <Badge tone="green">✓ on-site</Badge>
                                ) : (
                                  <Badge tone="sand">unverified</Badge>
                                )}
                                {typeof sub.distanceMeters === "number" && (
                                  <span className="text-[0.625rem] text-ink-soft">
                                    {sub.distanceMeters} m
                                  </span>
                                )}
                              </div>
                              <p className="text-[0.625rem] text-ink-soft">
                                {new Date(sub.ts).toLocaleString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

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
              disabled={saving}
              className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save hunt"}
            </button>
            {savedHuntId && (
              <a
                href={`/hunt/${draft.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
              >
                View live page ↗
              </a>
            )}
            {/* E14: always mounted so the outcome is announced when it
                arrives; sr-only while empty so the row's gap is unchanged. */}
            <p
              role="status"
              aria-live="polite"
              className={
                message
                  ? `text-sm font-medium ${message.kind === "ok" ? "text-fern" : "text-coral-deep"}`
                  : "sr-only"
              }
            >
              {message?.text}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
