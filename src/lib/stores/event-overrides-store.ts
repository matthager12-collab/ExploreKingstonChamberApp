// Admin dedupe verdicts (E12): a human's ruling on one occurrence-key pair,
// in either direction —
//   "not-duplicate" — "these two calendar entries are NOT the same event"
//                     (FR-EVT-02's original override); pins the pair apart,
//                     honored transitively.
//   "same-event"    — "these two ARE one event"; forces a merge the matcher
//                     missed. Added 2026-08-06 alongside dedupe's containment
//                     pass: the pass catches the AMS town-prefix pattern, this
//                     is the recourse for everything it doesn't.
// Keys reference the ORIGINAL-start occurrence stamps, which survive upstream
// reschedules. mergeCalendar applies both.

import "server-only";

import type { DedupeOverride, DedupeVerdict } from "@/lib/events/dedupe";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "event-overrides";

export interface EventOverrideRecord {
  id: string;
  keyA: string;
  keyB: string;
  verdict: DedupeVerdict;
  setBy: string;
  setAt: string;
}

/** Canonical id for a pair — order-independent, so the same verdict entered
 *  from either direction upserts one record.
 *
 *  Both verdicts share this id space ON PURPOSE: a pair has ONE current
 *  ruling, so changing your mind (split a pair you merged, or merge a pair you
 *  split) overwrites rather than accumulating two contradictory records. */
export function overrideId(keyA: string, keyB: string): string {
  const [a, b] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return `${a}|${b}`;
}

export async function listEventOverrides(): Promise<EventOverrideRecord[]> {
  return readMerged<EventOverrideRecord>(STORE, []);
}

/** The shape mergeCalendar consumes. */
export async function listDedupeOverrides(): Promise<DedupeOverride[]> {
  return (await listEventOverrides()).map(({ keyA, keyB, verdict }) => ({
    keyA,
    keyB,
    verdict,
  }));
}

export async function addEventOverride(
  keyA: string,
  keyB: string,
  setBy: string,
  verdict: DedupeVerdict = "not-duplicate",
  meta?: WriteMeta,
): Promise<EventOverrideRecord> {
  const record: EventOverrideRecord = {
    id: overrideId(keyA, keyB),
    keyA,
    keyB,
    verdict,
    setBy,
    setAt: new Date().toISOString(),
  };
  await writeOverlayRecord(STORE, record, meta);
  return record;
}

export async function removeEventOverride(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, { id, _deleted: true } as EventOverrideRecord & {
    _deleted: true;
  }, meta);
}
