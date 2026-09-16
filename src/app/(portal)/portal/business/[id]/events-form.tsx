"use client";

// Tab 3 of the business listing editor: the events manager, including the
// "what else happens that day" deconfliction check.
//
// Was "section c" of editor.tsx. Every handler, endpoint, payload and piece of
// copy is moved across unchanged — including the best-effort deconfliction
// fetch and the pending-removal behaviour, where a member's delete of a live
// event keeps the row visible so the portal doesn't pretend it has gone.

import { useEffect, useState, type FormEvent } from "react";
import type { EventCategory, EventItem, Restaurant } from "@/lib/types";
import { Badge, Callout } from "@/components/ui";
import { RepeatField, type RepeatValue } from "@/components/repeat-field";
import {
  Button,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/portal/form";
import { SaveMessage, useSave } from "@/components/portal/business-save";

const CATEGORIES: EventCategory[] = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
];

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

interface EventDraft {
  id?: string;
  title: string;
  start: string; // datetime-local value
  end: string;
  venue: string;
  description: string;
  category: EventCategory;
  url: string;
  /** Repeat rule + skipped dates, straight from RepeatField. */
  repeat: RepeatValue;
}

export function EventsForm({
  initial,
  initialEvents,
}: {
  initial: Restaurant;
  initialEvents: EventItem[];
}) {
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
      repeat: {},
    };
  }

  function editEvent(ev: EventItem) {
    setDraft({
      id: ev.id,
      title: ev.title,
      repeat: { ...(ev.rrule ? { rrule: ev.rrule } : {}), ...(ev.exdates ? { exdates: ev.exdates } : {}) },
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
          rrule: current.repeat.rrule,
          exdates: current.repeat.exdates,
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

  return (
    <FormSection
      title="Your events"
      description="Trivia night, live music, a crab feed — post it here and it lands on the town calendar."
    >
      {events.length === 0 && !draft && (
        <p className="text-ink-soft">
          Nothing scheduled yet. Your first event is one click away.
        </p>
      )}

      {events.length > 0 && (
        <ul className="flex flex-col gap-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-primary-deep">{ev.title}</p>
                  <Badge tone="teal">{ev.category}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {fmtEventDate(ev.start)} · {ev.venue}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" type="button" onClick={() => editEvent(ev)}>
                  Edit
                </Button>
                <Button variant="ghost" type="button" onClick={() => void removeEvent(ev)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="rounded-xl border border-border bg-surface-sunken p-4">
          <p className="font-display text-lg font-semibold text-primary-deep">
            {draft.id ? "Edit event" : "New event"}
          </p>
          <form onSubmit={saveDraft} className="mt-4 flex flex-col gap-5">
            <TextField label="Title" value={draft.title} onChange={setE("title")} required />

            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Starts"
                type="datetime-local"
                value={draft.start}
                onChange={setE("start")}
                required
              />
              <TextField
                label="Ends"
                hint="Optional."
                type="datetime-local"
                value={draft.end}
                onChange={setE("end")}
              />
              <TextField label="Venue" value={draft.venue} onChange={setE("venue")} />
              <SelectField
                label="Category"
                value={draft.category}
                onChange={setE("category")}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
            </div>

            <TextAreaField
              label="Description"
              value={draft.description}
              onChange={setE("description")}
              rows={3}
            />
            <TextField
              label="Link"
              hint="Tickets or info. Optional."
              value={draft.url}
              onChange={setE("url")}
              type="url"
              placeholder="https://…"
            />

            {/* Repeat. Sits after the one-off details on purpose: you
                describe the event first, then say how often it happens —
                and the preview needs a start date to be meaningful. */}
            {draft.start.length >= 16 ? (
              <RepeatField
                startIso={draft.start}
                value={draft.repeat}
                onChange={(repeat) => setDraft((d) => (d ? { ...d, repeat } : d))}
                idPrefix="portal-repeat"
                inputClass="mt-1 block w-full rounded-lg border border-border-strong bg-white px-3 py-2.5 text-base text-ink"
                labelClass="block text-sm font-semibold text-ink"
              />
            ) : (
              <p className="text-sm text-ink-soft">
                Set a start date and time above to make this event repeat.
              </p>
            )}

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
              <Button type="submit" pending={eventSave.busy}>
                {draft.id ? "Save changes" : "Add event"}
              </Button>
              <Button variant="ghost" type="button" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <SaveMessage message={eventSave.message} />
            </div>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => setDraft(blankDraft())}>
            + Add an event
          </Button>
          <SaveMessage message={eventSave.message} />
        </div>
      )}
    </FormSection>
  );
}
