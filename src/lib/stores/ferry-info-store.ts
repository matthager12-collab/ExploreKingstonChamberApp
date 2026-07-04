// Admin-editable ferry FACTS — the structured payment / boarding-pass / cash /
// sources data behind /ferry and /parking. Unlike the prose copy blocks (which
// are single strings in site-store), these are small structured records the
// Chamber edits field-by-field at /admin/ferry-info.
//
// Storage: one overlay store "ferry-info" with exactly four id'd records —
// "payment", "boarding-pass", "cash-tips", "sources". Each record's `doc` is
// the whole object/array from src/lib/data/ferry-info.ts. An untouched record
// costs nothing and always tracks the seed baked into the code; saving one
// stores the edited object as the overlay, which wins.
//
// The seed consts are `as const` (deeply readonly); the exported field types
// below are the mutable equivalents so the admin editor and API can build a
// fresh doc, while the shapes stay identical to the seed so /ferry and
// /parking render exactly the same.

import {
  BOARDING_PASS,
  CASH_TIPS,
  FERRY_PAYMENT,
  SOURCES,
  type BoardingPass,
  type FerryInfo,
  type FerryPayment,
  type Source,
} from "../data/ferry-info";
import { readMerged, writeOverlayRecord } from "./json-store";

const STORE = "ferry-info";

// Field/record types live in the pure data module (../data/ferry-info) so the
// client editor can import them without pulling in this server-only store.
// Re-export here for the API route, which already imports from the store.
export type { BoardingPass, FerryInfo, FerryPayment, Source };

// The four record ids, in editor order.
export const FERRY_INFO_IDS = ["payment", "boarding-pass", "cash-tips", "sources"] as const;
export type FerryInfoId = (typeof FERRY_INFO_IDS)[number];

// Each stored record is { id, doc }. `doc` is whatever object/array that id owns.
interface FerryInfoRecord {
  id: FerryInfoId;
  doc: unknown;
}

// Seed rows: overlay wins by id, else these (mirrors the code const exactly).
const SEED: FerryInfoRecord[] = [
  { id: "payment", doc: FERRY_PAYMENT as unknown as FerryPayment },
  { id: "boarding-pass", doc: BOARDING_PASS as unknown as BoardingPass },
  { id: "cash-tips", doc: CASH_TIPS as string[] },
  { id: "sources", doc: SOURCES as Source[] },
];

/** All four ferry-fact records (merged), for the admin editor + API GET. */
export async function getFerryInfoRecords(): Promise<
  { id: FerryInfoId; doc: unknown }[]
> {
  const rows = await readMerged<FerryInfoRecord>(STORE, SEED);
  // Preserve the canonical id order regardless of overlay insertion order.
  const byId = new Map(rows.map((r) => [r.id, r.doc]));
  return FERRY_INFO_IDS.map((id) => ({ id, doc: byId.get(id) }));
}

/**
 * The four facts, merged (overlay wins, else the seed), shaped for the pages.
 * One store read per render — fine, same pattern as getCopyOverrides().
 */
export async function getFerryInfo(): Promise<FerryInfo> {
  const byId = new Map((await getFerryInfoRecords()).map((r) => [r.id, r.doc]));
  return {
    payment: (byId.get("payment") ?? FERRY_PAYMENT) as FerryPayment,
    boardingPass: (byId.get("boarding-pass") ?? BOARDING_PASS) as BoardingPass,
    cashTips: (byId.get("cash-tips") ?? CASH_TIPS) as string[],
    sources: (byId.get("sources") ?? SOURCES) as Source[],
  };
}

/** Save one edited record. Caller (the admin API) validates id + shape first. */
export async function saveFerryInfoRecord(
  id: FerryInfoId,
  doc: unknown,
): Promise<void> {
  await writeOverlayRecord<FerryInfoRecord>(STORE, { id, doc });
}
