"use client";

// The business listing editor: details, the weekly-hours editor with a live
// open/closed preview + regenerated human-readable summary, and the events
// manager with the "what else happens that day" check.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { EventCategory, EventItem, Restaurant, WeeklyHours } from "@/lib/types";
import { getOpenStatus } from "@/lib/hours";
import { Badge, Callout, Card, Section } from "@/components/ui";
import {
  HoursEditor,
  emptyWeeklyHours,
  weeklyHoursIssues,
} from "@/components/portal/hours-editor";

// ---------- shared styles (same vocabulary as portal/forms.tsx) ----------

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const subtleButtonClass =
  "rounded-full border border-sand px-4 py-1.5 text-sm font-medium text-ink hover:border-tide";

const CATEGORIES: EventCategory[] = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
];

const PLATFORMS: { value: string; label: string }[] = [
  { value: "", label: "Not set" },
  { value: "toast", label: "Toast" },
  { value: "square", label: "Square" },
  { value: "doordash", label: "DoorDash" },
  { value: "own-site", label: "Our own website" },
  { value: "phone-only", label: "Phone orders only" },
];

// ---------- the human-readable hours formatter ----------

const DAY_ORDER: (keyof WeeklyHours)[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<keyof WeeklyHours, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** "20:00" -> "8 pm", "09:30" -> "9:30 am", "00:00" -> "midnight", "12:00" -> "noon" */
function fmtTime(hhmm: string): string {
  if (hhmm === "00:00" || hhmm === "24:00") return "midnight";
  if (hhmm === "12:00") return "noon";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function fmtSpans(spans: [string, string][]): string {
  if (spans.length === 0) return "closed";
  return spans.map(([open, close]) => `${fmtTime(open)}–${fmtTime(close)}`).join(" & ");
}

/**
 * Regenerate the human-readable hours line from structured weekly hours,
 * grouping consecutive days with identical spans:
 * "Mon–Thu 11 am–9:30 pm, Fri–Sat 11 am–midnight, Sun closed".
 */
export function formatWeeklyHours(weekly: WeeklyHours): string {
  const groups: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const text = fmtSpans(weekly[DAY_ORDER[i]] ?? []);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.end = i;
    else groups.push({ start: i, end: i, text });
  }
  if (groups.every((g) => g.text === "closed")) return "Closed";
  return groups
    .map((g) => {
      const label =
        g.start === g.end
          ? DAY_LABEL[DAY_ORDER[g.start]]
          : `${DAY_LABEL[DAY_ORDER[g.start]]}–${DAY_LABEL[DAY_ORDER[g.end]]}`;
      return `${label} ${g.text}`;
    })
    .join(", ");
}

/**
 * If the stored hours string is our generated summary plus a suffix note,
 * recover the note so it survives a round-trip through the editor.
 */
function initialNote(r: Restaurant): string {
  if (!r.hours || !r.weeklyHours) return "";
  const base = formatWeeklyHours(r.weeklyHours);
  if (r.hours.startsWith(base) && r.hours.length > base.length) {
    return r.hours.slice(base.length).replace(/^\s*—\s*/, "").trim();
  }
  return "";
}

// ---------- small helpers ----------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

/** Member saves hold for Chamber review (E08); the API says so with
 *  `pending: true` and the success copy must not promise instant publish. */
const PENDING_TEXT = "Submitted — goes live after Chamber review.";

function useSave() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /** run() returns true when the API held the write for review. */
  async function save(
    run: () => Promise<boolean | void>,
    successText: string,
    pendingText: string = PENDING_TEXT,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const pending = await run();
      setMessage({ ok: true, text: pending === true ? pendingText : successText });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Something went wrong — try again",
      });
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, save };
}

function SaveMessage({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p
      className={`text-sm font-medium ${message.ok ? "text-fern" : "text-coral-deep"}`}
      role="status"
    >
      {message.text}
    </p>
  );
}

async function putListing(
  payload: Record<string, unknown>,
): Promise<{ listing: Restaurant; pending: boolean }> {
  const res = await fetch("/api/portal/listing", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    listing?: Restaurant;
    pending?: boolean;
  };
  if (!res.ok || !data.listing) throw new Error(data.error ?? "Save failed");
  return { listing: data.listing, pending: Boolean(data.pending) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Deterministic date-time label straight from the ISO string (no timezone math). */
function fmtEventDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, h, min] = m;
  const weekday = WEEKDAYS[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  const hour = +h;
  const suffix = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const time = min === "00" ? `${hour12} ${suffix}` : `${hour12}:${min} ${suffix}`;
  return `${weekday}, ${MONTHS[+mo - 1]} ${+d} · ${time}`;
}

// ---------- event draft ----------

interface EventDraft {
  id?: string;
  title: string;
  start: string; // datetime-local value
  end: string;
  venue: string;
  description: string;
  category: EventCategory;
  url: string;
}

// ---------- the editor ----------

export function BusinessEditor({
  initial,
  initialEvents,
}: {
  initial: Restaurant;
  initialEvents: EventItem[];
}) {
  // --- section a: listing details ---
  const [details, setDetails] = useState({
    description: initial.description,
    phone: initial.phone ?? "",
    website: initial.website ?? "",
    menuUrl: initial.menuUrl ?? "",
    orderingUrl: initial.orderingUrl ?? "",
    orderingPlatform: initial.orderingPlatform ?? "",
    cuisine: initial.cuisine,
    priceLevel: String(initial.priceLevel),
    tags: initial.tags.join(", "),
    address: initial.address,
  });
  const detailsSave = useSave();

  const setD =
    (key: keyof typeof details) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDetails((d) => ({ ...d, [key]: e.target.value }));

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    void detailsSave.save(async () => {
      const result = await putListing({
        id: initial.id,
        description: details.description,
        phone: details.phone,
        website: details.website,
        menuUrl: details.menuUrl,
        orderingUrl: details.orderingUrl,
        orderingPlatform: details.orderingPlatform,
        cuisine: details.cuisine,
        priceLevel: Number(details.priceLevel),
        tags: details.tags.split(",").map((t) => t.trim()).filter(Boolean),
        address: details.address,
      });
      return result.pending;
    }, "Saved — live on every page this listing appears.");
  }

  // --- section b: hours ---
  const [weekly, setWeekly] = useState<WeeklyHours>(
    initial.weeklyHours ?? emptyWeeklyHours(),
  );
  const [note, setNote] = useState(() => initialNote(initial));
  const [verified, setVerified] = useState(initial.hoursVerified);
  const hoursSave = useSave();

  const summary = useMemo(() => formatWeeklyHours(weekly), [weekly]);
  const composedHours = note.trim() ? `${summary} — ${note.trim()}` : summary;
  const hoursIssues = weeklyHoursIssues(weekly);

  // Live open/closed preview — null until after mount so SSR and the first
  // client render agree; re-checks each minute like the public badge.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const kickoff = setTimeout(update, 0);
    const timer = setInterval(update, 60_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, []);
  const liveStatus = nowMs !== null ? getOpenStatus(weekly, new Date(nowMs)) : null;

  function saveHours() {
    void hoursSave.save(async () => {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Los_Angeles",
      });
      const result = await putListing({
        id: initial.id,
        weeklyHours: weekly,
        hours: composedHours,
        hoursVerified: today,
      });
      setVerified(result.listing.hoursVerified);
      return result.pending;
    }, "Hours saved and marked verified today. The open-now badge follows instantly.");
  }

  // --- section c: events ---
  const [events, setEvents] = useState<EventItem[]>(initialEvents);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  // Fetched deconfliction results, remembered with the date they answer for —
  // the visible list is derived, so a date change instantly clears stale hits.
  const [dayCheck, setDayCheck] = useState<{ date: string; events: EventItem[] }>({
    date: "",
    events: [],
  });
  const eventSave = useSave();

  const draftDate = draft && draft.start.length >= 10 ? draft.start.slice(0, 10) : "";
  const draftId = draft?.id ?? "";
  const conflicts = draftDate && dayCheck.date === draftDate ? dayCheck.events : [];

  useEffect(() => {
    if (!draftDate) return;
    let cancelled = false;
    const params = new URLSearchParams({ onDate: draftDate });
    if (draftId) params.set("exclude", draftId);
    fetch(`/api/portal/events?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { events?: EventItem[] }) => {
        if (!cancelled) setDayCheck({ date: draftDate, events: data.events ?? [] });
      })
      .catch(() => {
        /* deconfliction is best-effort — never block the form on it */
      });
    return () => {
      cancelled = true;
    };
  }, [draftDate, draftId]);

  function blankDraft(): EventDraft {
    return {
      title: "",
      start: "",
      end: "",
      venue: initial.name,
      description: "",
      category: "community",
      url: "",
    };
  }

  function editEvent(ev: EventItem) {
    setDraft({
      id: ev.id,
      title: ev.title,
      start: ev.start.slice(0, 16),
      end: ev.end ? ev.end.slice(0, 16) : "",
      venue: ev.venue,
      description: ev.description,
      category: ev.category,
      url: ev.url ?? "",
    });
  }

  const setE =
    (key: keyof EventDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDraft((d) => (d ? { ...d, [key]: e.target.value } : d));

  function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const current = draft;
    void eventSave.save(async () => {
      const res = await fetch("/api/portal/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          title: current.title,
          start: current.start,
          end: current.end || undefined,
          venue: current.venue || initial.name,
          description: current.description,
          category: current.category,
          url: current.url || undefined,
          ownerId: initial.id,
          organizer: initial.name,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        event?: EventItem;
        pending?: boolean;
      };
      if (!res.ok || !data.event) throw new Error(data.error ?? "Save failed");
      const saved = data.event;
      setEvents((prev) =>
        prev
          .filter((x) => x.id !== saved.id)
          .concat(saved)
          .sort((a, b) => a.start.localeCompare(b.start)),
      );
      setDraft(null);
      return Boolean(data.pending);
    }, "Event saved — it's on the town calendar now.");
  }

  async function removeEvent(ev: EventItem) {
    if (!window.confirm(`Delete "${ev.title}"? It disappears from the calendar.`)) return;
    void eventSave.save(
      async () => {
        const res = await fetch(`/api/portal/events?id=${encodeURIComponent(ev.id)}`, {
          method: "DELETE",
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          pending?: boolean;
        };
        if (!res.ok) throw new Error(data.error ?? "Delete failed");
        // A member removal of a live event holds for review — keep it in the
        // list so the portal doesn't pretend it's already gone.
        if (!data.pending) setEvents((prev) => prev.filter((x) => x.id !== ev.id));
        return Boolean(data.pending);
      },
      "Event deleted.",
      "Removal submitted — the event stays on the calendar until the Chamber approves.",
    );
  }

  // ---------- render ----------

  return (
    <>
      {/* a. Listing details */}
      <Section
        title="Listing details"
        subtitle="What visitors see on the food pages and the map."
      >
        <Card>
          <form onSubmit={saveDetails} className="space-y-4">
            <Field label="Description">
              <textarea
                value={details.description}
                onChange={setD("description")}
                rows={3}
                required
                className={inputClass}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <input value={details.phone} onChange={setD("phone")} className={inputClass} />
              </Field>
              <Field label="Website">
                <input
                  value={details.website}
                  onChange={setD("website")}
                  type="url"
                  placeholder="https://…"
                  className={inputClass}
                />
              </Field>
              <Field label="Menu link">
                <input
                  value={details.menuUrl}
                  onChange={setD("menuUrl")}
                  type="url"
                  placeholder="https://…"
                  className={inputClass}
                />
              </Field>
              <Field label="Online ordering link">
                <input
                  value={details.orderingUrl}
                  onChange={setD("orderingUrl")}
                  type="url"
                  placeholder="https://…"
                  className={inputClass}
                />
              </Field>
              <Field label="Ordering platform">
                <select
                  value={details.orderingPlatform}
                  onChange={setD("orderingPlatform")}
                  className={inputClass}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cuisine">
                <input
                  value={details.cuisine}
                  onChange={setD("cuisine")}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Price level">
                <select
                  value={details.priceLevel}
                  onChange={setD("priceLevel")}
                  className={inputClass}
                >
                  <option value="1">$ — casual</option>
                  <option value="2">$$ — mid-range</option>
                  <option value="3">$$$ — special occasion</option>
                </select>
              </Field>
              <Field label="Tags (comma separated)">
                <input
                  value={details.tags}
                  onChange={setD("tags")}
                  placeholder="waterfront, kid-friendly, takeout"
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Address">
              <input
                value={details.address}
                onChange={setD("address")}
                required
                className={inputClass}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" disabled={detailsSave.busy} className={buttonClass}>
                {detailsSave.busy ? "Saving…" : "Save details"}
              </button>
              <SaveMessage message={detailsSave.message} />
            </div>
          </form>
        </Card>
      </Section>

      {/* b. Hours */}
      <Section
        title="Hours"
        subtitle="Set them once here — the live open-now badge, the food pages, and your syndication feed all follow."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <HoursEditor value={weekly} onChange={setWeekly} />

          <div className="space-y-4">
            <Card>
              <p className="text-xs font-semibold tracking-widest text-tide uppercase">
                Live preview
              </p>
              <div className="mt-2">
                {liveStatus ? (
                  // Contrast: this is a preview of <OpenBadge>, so it carries the
                  // same tones. The tinted pairs it used to have failed AA at this
                  // 12px size — text-fern on bg-fern/10 was 4.29:1 and text-ink-soft
                  // on bg-sand 3.62:1. Solid fern with white text is 4.86:1 and sand
                  // with text-ink is 11.95:1, matching src/components/open-badge.tsx.
                  // A preview that renders differently from the badge it previews is
                  // worse than useless, so these must stay in step.
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      liveStatus.open ? "bg-fern text-white" : "bg-sand text-ink"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        liveStatus.open ? "bg-white" : "bg-ink/40"
                      }`}
                      aria-hidden
                    />
                    {liveStatus.label}
                  </span>
                ) : (
                  <span className="text-xs text-ink-soft">Checking…</span>
                )}
              </div>
              <p className="mt-4 text-xs font-semibold tracking-widest text-tide uppercase">
                How it will read
              </p>
              <p className="mt-1 text-sm text-ink">{composedHours}</p>
              <div className="mt-4">
                <Field label="Note to append (optional)">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="kitchen closes 30 min early"
                    className={inputClass}
                  />
                </Field>
              </div>
              <p className="mt-3 text-xs text-ink-soft">
                {verified
                  ? `Hours last verified ${verified}. Saving re-verifies them today.`
                  : "These hours haven't been verified yet — saving marks them verified today."}
              </p>
              {hoursIssues.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {hoursIssues.map((issue) => (
                    <li key={issue} className="text-xs font-medium text-coral-deep">
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={saveHours}
                  disabled={hoursSave.busy || hoursIssues.length > 0}
                  className={buttonClass}
                >
                  {hoursSave.busy ? "Saving…" : "Save hours"}
                </button>
              </div>
              <div className="mt-2">
                <SaveMessage message={hoursSave.message} />
              </div>
            </Card>
          </div>
        </div>
      </Section>

      {/* c. Events */}
      <Section
        title="Your events"
        subtitle="Trivia night, live music, a crab feed — post it here and it lands on the town calendar."
      >
        <div className="space-y-4">
          {events.length === 0 && !draft && (
            <p className="text-sm text-ink-soft">
              Nothing scheduled yet. Your first event is one click away.
            </p>
          )}

          {events.map((ev) => (
            <Card key={ev.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sound-deep">{ev.title}</p>
                  <Badge tone="teal">{ev.category}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {fmtEventDate(ev.start)} · {ev.venue}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => editEvent(ev)}
                  className={subtleButtonClass}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void removeEvent(ev)}
                  className="rounded-full border border-sand px-4 py-1.5 text-sm font-medium text-coral-deep hover:border-coral"
                >
                  Delete
                </button>
              </div>
            </Card>
          ))}

          {draft ? (
            <Card>
              <p className="font-display text-lg font-semibold text-sound-deep">
                {draft.id ? "Edit event" : "New event"}
              </p>
              <form onSubmit={saveDraft} className="mt-4 space-y-4">
                <Field label="Title">
                  <input
                    value={draft.title}
                    onChange={setE("title")}
                    required
                    className={inputClass}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Starts">
                    <input
                      type="datetime-local"
                      value={draft.start}
                      onChange={setE("start")}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Ends (optional)">
                    <input
                      type="datetime-local"
                      value={draft.end}
                      onChange={setE("end")}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Venue">
                    <input value={draft.venue} onChange={setE("venue")} className={inputClass} />
                  </Field>
                  <Field label="Category">
                    <select
                      value={draft.category}
                      onChange={setE("category")}
                      className={inputClass}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Description">
                  <textarea
                    value={draft.description}
                    onChange={setE("description")}
                    rows={3}
                    className={inputClass}
                  />
                </Field>
                <Field label="Link (tickets or info, optional)">
                  <input
                    value={draft.url}
                    onChange={setE("url")}
                    type="url"
                    placeholder="https://…"
                    className={inputClass}
                  />
                </Field>

                {conflicts.length > 0 && (
                  <Callout
                    title={`${conflicts.length} other thing${conflicts.length === 1 ? " happens" : "s happen"} that day — still fine, just know`}
                  >
                    <ul className="list-disc space-y-0.5 pl-4">
                      {conflicts.map((c) => (
                        <li key={c.id}>
                          {c.title} · {fmtEventDate(c.start)}
                        </li>
                      ))}
                    </ul>
                  </Callout>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" disabled={eventSave.busy} className={buttonClass}>
                    {eventSave.busy ? "Saving…" : draft.id ? "Save changes" : "Add event"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className={subtleButtonClass}
                  >
                    Cancel
                  </button>
                  <SaveMessage message={eventSave.message} />
                </div>
              </form>
            </Card>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setDraft(blankDraft())} className={buttonClass}>
                + Add an event
              </button>
              <SaveMessage message={eventSave.message} />
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
