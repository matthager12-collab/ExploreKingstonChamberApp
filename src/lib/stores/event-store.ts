// Portal-editable events calendar.
// Seed data ships in src/lib/data/events.ts; portal edits overlay it.

import type { EventItem } from "../types";
import { events as seed } from "../data/events";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "events";

export async function getEvents(): Promise<EventItem[]> {
  const all = await readMerged<EventItem>(STORE, seed);
  return all.sort((a, b) => a.start.localeCompare(b.start));
}

export async function getEvent(id: string): Promise<EventItem | undefined> {
  return (await getEvents()).find((e) => e.id === id);
}

export async function saveEvent(record: EventItem, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, record, meta);
}

export async function deleteEvent(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, { id, _deleted: true } as EventItem & { _deleted: true }, meta);
}

const pacificDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});

/** Pacific calendar date ("YYYY-MM-DD") for an event timestamp. Handles both
 *  offset-carrying ISO strings and the naive local strings the portal's
 *  datetime-local inputs produce (those parse as server-local; slicing the
 *  raw string keeps their intended wall-clock date). */
function pacificDateKey(iso: string): string {
  if (!/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return iso.slice(0, 10);
  return pacificDay.format(new Date(iso));
}

/** Other events on the same Pacific calendar date — the deconfliction check. */
export async function eventsSharingDate(
  dateIso: string,
  excludeId?: string,
): Promise<EventItem[]> {
  const day = pacificDateKey(dateIso);
  return (await getEvents()).filter(
    (e) => pacificDateKey(e.start) === day && e.id !== excludeId,
  );
}
