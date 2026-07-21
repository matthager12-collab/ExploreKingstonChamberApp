// Portal-editable events calendar.
// Seed data ships in src/lib/data/events.ts; portal edits overlay it.

import type { EventItem } from "../types";
import { events as seed } from "../data/events";
import {
  readMerged,
  readMergedAdmin,
  writeOverlayRecord,
  type WithStatus,
  type WriteMeta,
} from "./json-store";

const STORE = "events";

export async function getEvents(): Promise<EventItem[]> {
  const all = await readMerged<EventItem>(STORE, seed);
  return all.sort((a, b) => a.start.localeCompare(b.start));
}

export async function getEvent(id: string): Promise<EventItem | undefined> {
  return (await getEvents()).find((e) => e.id === id);
}

/** PRIVILEGED (E08): every status, status surfaced — admin surfaces only. */
export async function getEventsAdmin(): Promise<WithStatus<EventItem>[]> {
  const all = await readMergedAdmin<EventItem>(STORE, seed);
  return all.sort((a, b) => a.start.localeCompare(b.start));
}

/** PRIVILEGED (E08): one event, any status — for auth-gated update paths
 *  where the subject may be a pending submission (invisible to getEvent). */
export async function getEventAdmin(id: string): Promise<WithStatus<EventItem> | undefined> {
  return (await getEventsAdmin()).find((e) => e.id === id);
}

/** Owner-scoped read (E08): the owner's events including their own pending
 *  submissions, status surfaced so the portal can badge "awaiting review".
 *  Admin drafts stay invisible even to the owner. */
export async function getEventsForOwner(ownerId: string): Promise<WithStatus<EventItem>[]> {
  const all = await readMergedAdmin<EventItem>(STORE, seed, {
    statuses: ["live", "pending"],
  });
  return all
    .filter((e) => e.ownerId === ownerId || e.charityId === ownerId)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export async function saveEvent(record: EventItem, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, record, meta);
}

export async function deleteEvent(id: string, meta?: WriteMeta): Promise<void> {
  // Grab any uploaded artwork/flyers BEFORE tombstoning so the deleted event
  // doesn't leave orphaned bytes behind (E12 follow-up). Best-effort: the
  // tombstone is the source of truth; a failed blob delete is housekeeping.
  const existing = await getEventAdmin(id);
  await writeOverlayRecord(STORE, { id, _deleted: true } as EventItem & { _deleted: true }, meta);
  if (existing?.attachments?.length) {
    const { deleteAttachment } = await import("@/lib/events/attachment-store");
    await Promise.all(existing.attachments.map((r) => deleteAttachment(r)));
  }
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
