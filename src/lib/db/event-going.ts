// "I'm going" tallies — the LTAC attendance-and-origin numbers (db layer).
//
// Consumers import src/lib/stores/event-going-store.ts, never this file:
// src/lib/db is the only place allowed to touch the Drizzle client, and the
// store module is the domain API over it (same split as worklist.ts /
// worklist-store.ts). lint:boundaries enforces it.
//
// The store is a COUNTER, not a log. Every write is an upsert that increments
// (event, zip) by one; there is no row per visitor and therefore nothing to
// anonymize, export, or delete by identifier later. Building it this way was
// cheaper than building a log and then proving the log was safe.
//
// Repeat taps are suppressed ON THE DEVICE (localStorage), because the only
// server-side way to spot them would be an identifier — the exact thing this
// table refuses to hold. That makes the count honest-but-not-audited: good
// enough for "roughly how many people were interested", not a ticket sale.
// Say so wherever the number is published.

import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "./client";
import { eventGoing } from "./schema";

/** A ZIP we will store, or "" for "they didn't say". Anything else is dropped
 *  rather than corrected: a half-typed ZIP is not data, and storing it would
 *  put a value in the LTAC column that no one can interpret. */
export function normalizeZip(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const digits = raw.trim().slice(0, 5);
  return /^\d{5}$/.test(digits) ? digits : "";
}

/** Record one "I'm going" tap. Returns the event's new total. */
export async function recordGoing(eventId: string, zip: string): Promise<number> {
  const db = getDb();
  await db
    .insert(eventGoing)
    .values({ eventId, zip, count: 1 })
    .onConflictDoUpdate({
      target: [eventGoing.eventId, eventGoing.zip],
      set: {
        count: sql`${eventGoing.count} + 1`,
        updatedAt: sql`now()`,
      },
    });
  return (await getGoingCounts([eventId]))[eventId] ?? 0;
}

/** Total taps per event id, for the ids asked about. Events with no taps are
 *  absent from the map rather than present as 0 — the caller renders nothing
 *  for them, and "no one yet" should not look like a measured zero. */
export async function getGoingCounts(
  eventIds: string[],
): Promise<Record<string, number>> {
  if (eventIds.length === 0) return {};
  const rows = await getDb()
    .select({
      eventId: eventGoing.eventId,
      total: sql<number>`sum(${eventGoing.count})::int`,
    })
    .from(eventGoing)
    .where(inArray(eventGoing.eventId, eventIds))
    .groupBy(eventGoing.eventId);
  return Object.fromEntries(rows.map((r) => [r.eventId, r.total]));
}

/** The LTAC view for one event: how many said they were coming, and from
 *  which ZIPs. Unanswered taps come back under "" so the total always
 *  reconciles — a report that quietly drops them would overstate how much
 *  origin data the Chamber actually has. */
export async function getGoingByZip(
  eventId: string,
): Promise<{ zip: string; count: number }[]> {
  const rows = await getDb()
    .select({ zip: eventGoing.zip, count: eventGoing.count })
    .from(eventGoing)
    .where(eq(eventGoing.eventId, eventId));
  return rows.sort((a, b) => b.count - a.count || a.zip.localeCompare(b.zip));
}

/** How many tallies are past the retention window (the dry-run number). */
export async function countGoingBefore(cutoff: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(eventGoing)
    .where(sql`${eventGoing.updatedAt} < ${cutoff}`);
  return row?.n ?? 0;
}

/** Retention purge: drop tallies whose last tap is older than the window.
 *  Deletes the whole (event, zip) row — a tally has no per-tap rows to thin,
 *  and a count with its clock expired is the thing being retired. */
export async function deleteGoingBefore(cutoff: string): Promise<number> {
  const deleted = await getDb()
    .delete(eventGoing)
    .where(sql`${eventGoing.updatedAt} < ${cutoff}`)
    .returning({ eventId: eventGoing.eventId });
  return deleted.length;
}
