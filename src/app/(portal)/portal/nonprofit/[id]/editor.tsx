"use client";

// Client editor for one nonprofit org:
//   1. Org profile (name, mission, website, contact email)
//   2. Volunteer shifts — upcoming list with a quick +/- signup stepper,
//      past shifts collapsed, full create/edit/delete
//   3. Events — CRUD with same-day deconfliction: picking a date immediately
//      shows what else is already on the town calendar, before committing.
// All writes are re-validated server-side; this UI is just the friendly face.

import {
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { Charity, EventCategory, EventItem, VolunteerNeed } from "@/lib/types";
import { Badge, Callout, Card, Section } from "@/components/ui";
import { formatPacificDate, formatPacificTime } from "@/lib/time";

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const smallButtonClass =
  "rounded-full border border-sand bg-white px-3 py-1 text-sm font-medium text-ink hover:border-tide disabled:opacity-40";
const stepperClass =
  "h-8 w-8 rounded-full border border-sand bg-white text-base font-semibold text-sound-deep hover:border-tide disabled:opacity-30";

const CATEGORY_OPTIONS: EventCategory[] = [
  "charity",
  "community",
  "festival",
  "market",
  "music",
  "sports",
  "arts",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

function formValues(e: FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  return Object.fromEntries(
    [...data.entries()].map(([k, v]) => [k, String(v)]),
  ) as Record<string, string>;
}

/** Member writes hold for Chamber review (E08); the API marks those
 *  responses with `pending: true` and the UI copy must say so. */
const PENDING_TEXT = "Submitted — goes live after Chamber review.";

type ApiResult<T> = Partial<T> & { ok?: boolean; error?: string; pending?: boolean };

async function api<T>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { error: "Network error — try again" } as ApiResult<T>;
  }
}

// ---------------------------------------------------------------- main shell

export function NonprofitEditor({
  org: initialOrg,
  initialNeeds,
  initialEvents,
  today,
}: {
  org: Charity;
  initialNeeds: VolunteerNeed[];
  initialEvents: EventItem[];
  today: string;
}) {
  const [org, setOrg] = useState(initialOrg);
  const [needs, setNeeds] = useState(initialNeeds);
  const [events, setEvents] = useState(initialEvents);

  return (
    <>
      <Section
        title="Organization profile"
        subtitle="Shown wherever your org appears on the site."
      >
        <OrgProfileForm org={org} onSaved={setOrg} />
      </Section>

      <Section
        title="Volunteer shifts"
        subtitle="Post shifts and use the stepper to track signups as they come in by email or phone."
      >
        <NeedsSection org={org} needs={needs} setNeeds={setNeeds} today={today} />
      </Section>

      <Section
        title="Your events"
        subtitle="When you pick a date, we check the town calendar so Kingston doesn't double-book itself."
      >
        <EventsSection org={org} events={events} setEvents={setEvents} today={today} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- org profile

function OrgProfileForm({ org, onSaved }: { org: Charity; onSaved: (o: Charity) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    const values = formValues(e);
    setBusy(true);
    setError(null);
    setSavedText(null);
    const data = await api<{ org: Charity }>("/api/portal/org", "PUT", {
      id: org.id,
      ...values,
    });
    setBusy(false);
    if (!data.ok || !data.org) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    onSaved(data.org);
    setSavedText(data.pending ? PENDING_TEXT : "Saved");
  }

  return (
    <Card className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Organization name">
          <input name="name" defaultValue={org.name} required className={inputClass} />
        </Field>
        <Field label="Mission">
          <textarea name="mission" defaultValue={org.mission} rows={3} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website">
            <input
              name="website"
              type="url"
              defaultValue={org.website ?? ""}
              placeholder="https://…"
              className={inputClass}
            />
          </Field>
          <Field label="Contact email">
            <input
              name="contactEmail"
              type="email"
              defaultValue={org.contactEmail ?? ""}
              className={inputClass}
            />
          </Field>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? "Saving…" : "Save profile"}
          </button>
          {savedText && <span role="status" className="text-sm font-medium text-fern">{savedText}</span>}
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------ volunteer needs

function NeedsSection({
  org,
  needs,
  setNeeds,
  today,
}: {
  org: Charity;
  needs: VolunteerNeed[];
  setNeeds: Dispatch<SetStateAction<VolunteerNeed[]>>;
  today: string;
}) {
  const [editing, setEditing] = useState<VolunteerNeed | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sorted = [...needs].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((n) => n.date.slice(0, 10) >= today);
  const past = sorted.filter((n) => n.date.slice(0, 10) < today).reverse();

  async function adjustSlots(need: VolunteerNeed, delta: 1 | -1) {
    setError(null);
    setNotice(null);
    // Optimistic bump; the server response (or a revert) settles it.
    setNeeds((prev) =>
      prev.map((n) =>
        n.id === need.id
          ? { ...n, slotsFilled: Math.max(0, Math.min(n.slotsTotal, n.slotsFilled + delta)) }
          : n,
      ),
    );
    const data = await api<{ need: VolunteerNeed }>("/api/portal/needs", "POST", {
      action: "slots",
      id: need.id,
      delta,
    });
    const saved = data.ok ? data.need : undefined;
    if (saved && data.pending) {
      // Held for Chamber review (E08): the public count hasn't changed —
      // revert the optimistic bump so this list matches what the site shows.
      setNeeds((prev) => prev.map((n) => (n.id === need.id ? need : n)));
      setNotice("Signup change submitted — the public count updates after Chamber review.");
    } else if (saved) {
      setNeeds((prev) => prev.map((n) => (n.id === saved.id ? saved : n)));
    } else {
      setNeeds((prev) => prev.map((n) => (n.id === need.id ? need : n)));
      setError(data.error ?? "Could not update signups");
    }
  }

  async function remove(need: VolunteerNeed) {
    if (!window.confirm(`Delete the shift "${need.title}"?`)) return;
    setError(null);
    setNotice(null);
    const data = await api("/api/portal/needs?id=" + encodeURIComponent(need.id), "DELETE");
    if (data.ok && data.pending) {
      // Removal of a live shift holds for review — keep it in the list.
      setNotice("Removal submitted — the shift stays up until the Chamber approves.");
    } else if (data.ok) {
      setNeeds((prev) => prev.filter((n) => n.id !== need.id));
      if (editing !== "new" && editing?.id === need.id) setEditing(null);
    } else {
      setError(data.error ?? "Could not delete the shift");
    }
  }

  function upsert(saved: VolunteerNeed, pending?: boolean) {
    setNeeds((prev) => [...prev.filter((n) => n.id !== saved.id), saved]);
    setEditing(null);
    setNotice(pending ? PENDING_TEXT : null);
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
      {notice && <p role="status" className="text-sm font-medium text-fern">{notice}</p>}

      {upcoming.length === 0 && (
        <p className="text-sm text-ink-soft">No upcoming shifts — post one below.</p>
      )}
      {upcoming.map((need) => (
        <NeedRow
          key={need.id}
          need={need}
          onSlots={adjustSlots}
          onEdit={() => setEditing(need)}
          onDelete={() => remove(need)}
        />
      ))}

      {editing ? (
        <NeedForm
          key={editing === "new" ? "new" : editing.id}
          org={org}
          initial={editing === "new" ? undefined : editing}
          onSaved={upsert}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button onClick={() => setEditing("new")} className={buttonClass}>
          + Post a shift
        </button>
      )}

      {past.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
            Past shifts ({past.length})
          </summary>
          <div className="mt-3 space-y-3 opacity-70">
            {past.map((need) => (
              <NeedRow
                key={need.id}
                need={need}
                onSlots={adjustSlots}
                onEdit={() => setEditing(need)}
                onDelete={() => remove(need)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function NeedRow({
  need,
  onSlots,
  onEdit,
  onDelete,
}: {
  need: VolunteerNeed;
  onSlots: (need: VolunteerNeed, delta: 1 | -1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const open = need.slotsTotal - need.slotsFilled;
  return (
    <Card className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-semibold text-sound-deep">{need.title}</p>
        <p className="text-sm text-ink-soft">
          {formatPacificDate(need.date)} · {need.timeRange}
        </p>
        {need.description && (
          <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{need.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSlots(need, -1)}
          disabled={need.slotsFilled <= 0}
          className={stepperClass}
          aria-label="One fewer signup"
        >
          −
        </button>
        <span className="min-w-20 text-center text-sm font-semibold text-ink">
          {need.slotsFilled} / {need.slotsTotal} filled
        </span>
        <button
          onClick={() => onSlots(need, 1)}
          disabled={open <= 0}
          className={stepperClass}
          aria-label="One more signup"
        >
          +
        </button>
        {open <= 0 ? (
          <Badge tone="green">Full</Badge>
        ) : (
          <Badge tone="teal">{open} open</Badge>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onEdit} className={smallButtonClass}>
          Edit
        </button>
        <button onClick={onDelete} className={`${smallButtonClass} text-coral-deep`}>
          Delete
        </button>
      </div>
    </Card>
  );
}

function NeedForm({
  org,
  initial,
  onSaved,
  onCancel,
}: {
  org: Charity;
  initial?: VolunteerNeed;
  onSaved: (need: VolunteerNeed, pending?: boolean) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    const v = formValues(e);
    setBusy(true);
    setError(null);
    const data = await api<{ need: VolunteerNeed }>("/api/portal/needs", "POST", {
      id: initial?.id,
      charityId: org.id,
      title: v.title,
      date: v.date,
      timeRange: v.timeRange,
      slotsTotal: Number(v.slotsTotal),
      slotsFilled: Number(v.slotsFilled),
      description: v.description,
    });
    setBusy(false);
    if (!data.ok || !data.need) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    onSaved(data.need, data.pending);
  }

  return (
    <Card className="max-w-2xl border-tide">
      <p className="mb-3 font-semibold text-sound-deep">
        {initial ? "Edit shift" : "New volunteer shift"}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Shift title">
          <input
            name="title"
            defaultValue={initial?.title ?? ""}
            required
            placeholder="Food bank distribution crew"
            className={inputClass}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <input
              name="date"
              type="date"
              defaultValue={initial?.date.slice(0, 10) ?? ""}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Time range">
            <input
              name="timeRange"
              defaultValue={initial?.timeRange ?? ""}
              required
              placeholder="9:00 AM – 1:00 PM"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Volunteers needed">
            <input
              name="slotsTotal"
              type="number"
              min={1}
              max={999}
              defaultValue={initial?.slotsTotal ?? 4}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Already signed up">
            <input
              name="slotsFilled"
              type="number"
              min={0}
              max={999}
              defaultValue={initial?.slotsFilled ?? 0}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            name="description"
            defaultValue={initial?.description ?? ""}
            rows={3}
            placeholder="What volunteers will do, and how to sign up."
            className={inputClass}
          />
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? "Saving…" : initial ? "Save shift" : "Post shift"}
          </button>
          <button type="button" onClick={onCancel} className={smallButtonClass}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------- events

function EventsSection({
  org,
  events,
  setEvents,
  today,
}: {
  org: Charity;
  events: EventItem[];
  setEvents: Dispatch<SetStateAction<EventItem[]>>;
  today: string;
}) {
  const [editing, setEditing] = useState<EventItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = sorted.filter((e) => e.start.slice(0, 10) >= today);
  const past = sorted.filter((e) => e.start.slice(0, 10) < today).reverse();

  async function remove(ev: EventItem) {
    if (!window.confirm(`Delete "${ev.title}"? This removes it from the public calendar.`))
      return;
    setError(null);
    setNotice(null);
    const data = await api("/api/portal/org", "POST", { action: "deleteEvent", id: ev.id });
    if (data.ok && data.pending) {
      // Removal of a live event holds for review — keep it in the list.
      setNotice("Removal submitted — the event stays on the calendar until the Chamber approves.");
    } else if (data.ok) {
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      if (editing !== "new" && editing?.id === ev.id) setEditing(null);
    } else {
      setError(data.error ?? "Could not delete the event");
    }
  }

  function upsert(saved: EventItem, pending?: boolean) {
    setEvents((prev) => [...prev.filter((e) => e.id !== saved.id), saved]);
    setEditing(null);
    setNotice(pending ? PENDING_TEXT : null);
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
      {notice && <p role="status" className="text-sm font-medium text-fern">{notice}</p>}

      {upcoming.length === 0 && (
        <p className="text-sm text-ink-soft">No upcoming events on the calendar.</p>
      )}
      {upcoming.map((ev) => (
        <EventRow key={ev.id} event={ev} onEdit={() => setEditing(ev)} onDelete={() => remove(ev)} />
      ))}

      {editing ? (
        <EventForm
          key={editing === "new" ? "new" : editing.id}
          org={org}
          initial={editing === "new" ? undefined : editing}
          onSaved={upsert}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button onClick={() => setEditing("new")} className={buttonClass}>
          + Add an event
        </button>
      )}

      {past.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
            Past events ({past.length})
          </summary>
          <div className="mt-3 space-y-3 opacity-70">
            {past.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                onEdit={() => setEditing(ev)}
                onDelete={() => remove(ev)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function EventRow({
  event,
  onEdit,
  onDelete,
}: {
  event: EventItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-sound-deep">{event.title}</p>
          <Badge tone="coral">{event.category}</Badge>
        </div>
        <p className="text-sm text-ink-soft">
          {formatPacificDate(event.start)} · {formatPacificTime(event.start)}
          {event.end ? ` – ${formatPacificTime(event.end)}` : ""} · {event.venue}
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={onEdit} className={smallButtonClass}>
          Edit
        </button>
        <button onClick={onDelete} className={`${smallButtonClass} text-coral-deep`}>
          Delete
        </button>
      </div>
    </Card>
  );
}

function EventForm({
  org,
  initial,
  onSaved,
  onCancel,
}: {
  org: Charity;
  initial?: EventItem;
  onSaved: (event: EventItem, pending?: boolean) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(initial ? initial.start.slice(0, 10) : "");
  // null = no date picked yet / lookup failed; [] = date is clear.
  const [clashes, setClashes] = useState<EventItem[] | null>(null);
  const excludeId = initial?.id;

  // Deconfliction: the moment a date is picked, ask what else happens that
  // day — the warning shows BEFORE they commit. Never blocks saving.
  useEffect(() => {
    if (!DATE_RE.test(date)) {
      setClashes(null);
      return;
    }
    let cancelled = false;
    const exclude = excludeId ? `&excludeId=${encodeURIComponent(excludeId)}` : "";
    fetch(`/api/portal/needs?onDate=${date}${exclude}`)
      .then((r) => r.json())
      .then((d: { events?: EventItem[] }) => {
        if (!cancelled) setClashes(d.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setClashes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [date, excludeId]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    const v = formValues(e);
    setBusy(true);
    setError(null);
    const data = await api<{ event: EventItem }>("/api/portal/org", "POST", {
      action: "saveEvent",
      orgId: org.id,
      event: {
        id: initial?.id,
        title: v.title,
        date: v.date,
        startTime: v.startTime,
        endTime: v.endTime,
        venue: v.venue,
        address: v.address,
        description: v.description,
        category: v.category,
        url: v.url,
      },
    });
    setBusy(false);
    if (!data.ok || !data.event) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    onSaved(data.event, data.pending);
  }

  return (
    <Card className="max-w-2xl border-tide">
      <p className="mb-3 font-semibold text-sound-deep">
        {initial ? "Edit event" : "New event"}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Event title">
          <input name="title" defaultValue={initial?.title ?? ""} required className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">
            <input
              name="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Starts">
            <input
              name="startTime"
              type="time"
              defaultValue={initial?.start.slice(11, 16) ?? ""}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Ends (optional)">
            <input
              name="endTime"
              type="time"
              defaultValue={initial?.end?.slice(11, 16) ?? ""}
              className={inputClass}
            />
          </Field>
        </div>

        {clashes && clashes.length > 0 && (
          <Callout title="Heads up: these are already happening that day" tone="coral">
            <ul className="space-y-1">
              {clashes.map((c) => (
                <li key={c.id}>
                  <span className="font-medium text-ink">{c.title}</span>
                  {" — "}
                  {formatPacificTime(c.start)} at {c.venue} ({c.organizer})
                </li>
              ))}
            </ul>
            <p className="mt-2">
              You can still schedule yours — this is just so events don&apos;t compete for the
              same crowd.
            </p>
          </Callout>
        )}
        {clashes && clashes.length === 0 && (
          <p className="text-sm font-medium text-fern">
            Nothing else on the town calendar that day — it&apos;s all yours.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue">
            <input
              name="venue"
              defaultValue={initial?.venue ?? ""}
              required
              placeholder="Mike Wallace Park"
              className={inputClass}
            />
          </Field>
          <Field label="Address (optional)">
            <input name="address" defaultValue={initial?.address ?? ""} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <select
              name="category"
              defaultValue={initial?.category ?? "charity"}
              className={inputClass}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Link (optional)">
            <input
              name="url"
              type="url"
              defaultValue={initial?.url ?? ""}
              placeholder="https://…"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            name="description"
            defaultValue={initial?.description ?? ""}
            rows={3}
            className={inputClass}
          />
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? "Saving…" : initial ? "Save event" : "Add event"}
          </button>
          <button type="button" onClick={onCancel} className={smallButtonClass}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
