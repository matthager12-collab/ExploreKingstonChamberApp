// Admin override for the SR-104 vehicle boarding-pass verdict.
//
// The home widget, /ferry, and the "get in the ferry line" nav all key off
// getBoardingPassStatus() — a season/hours ESTIMATE. Sometimes staff know better
// than the heuristic (the machine's down and officers are handing passes on an
// off-season Tuesday; or it's a slow shoulder-season weekend and the line's not
// running). This store lets an admin pin the verdict on or off for the rest of
// the day.
//
// "Time-based shift from standard, resets to normal after the day ends": the
// override is stamped with the Pacific day it was set on. getEffectiveBoardingPass
// applies it only while that stored day still equals today's Pacific day — so at
// the next Pacific midnight it silently lapses back to the estimate with no timer
// to fire and no DST edge cases. An admin can also clear it early ("use
// automatic"), which tombstones the record.
//
// Storage: the same overlay seam as everything else — one record, id "override",
// in store "boarding-pass-override". No seed (the natural state is "no override").

import { getBoardingPassStatus, pacificDayString, type BoardingPassStatus } from "../wsf";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "boarding-pass-override";
const RECORD_ID = "override";

interface BoardingPassOverrideRecord {
  id: typeof RECORD_ID;
  /** The verdict staff pinned: true = pass ON, false = pass OFF. */
  active: boolean;
  /** Pacific "YYYY-MM-DD" the override applies to; stale once today differs. */
  day: string;
  /** ISO timestamp it was set, for the admin display. */
  setAt: string;
  /** Who set it (name or email), for the admin display. */
  setBy: string;
}

/** The current, still-valid override, or null if none / it lapsed at midnight. */
export async function getBoardingPassOverride(
  now: Date = new Date(),
): Promise<BoardingPassOverrideRecord | null> {
  const rows = await readMerged<BoardingPassOverrideRecord>(STORE, []);
  const rec = rows.find((r) => r.id === RECORD_ID);
  if (!rec) return null;
  // Only honor an override stamped with today's Pacific day — otherwise it has
  // rolled over and we fall back to the estimate.
  return rec.day === pacificDayString(now) ? rec : null;
}

/** Pin the boarding-pass verdict on/off for the rest of today's Pacific day. */
export async function setBoardingPassOverride(
  active: boolean,
  setBy: string,
  now: Date = new Date(),
  meta?: WriteMeta,
): Promise<void> {
  await writeOverlayRecord<BoardingPassOverrideRecord>(
    STORE,
    {
      id: RECORD_ID,
      active,
      day: pacificDayString(now),
      setAt: now.toISOString(),
      setBy,
    },
    meta,
  );
}

/** Remove the override immediately (revert to the automatic estimate). */
export async function clearBoardingPassOverride(meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord<BoardingPassOverrideRecord & { _deleted: true }>(
    STORE,
    {
      id: RECORD_ID,
      active: false,
      day: "",
      setAt: "",
      setBy: "",
      _deleted: true,
    },
    meta,
  );
}

/**
 * The boarding-pass verdict the app should act on: a same-day admin override if
 * one is set, otherwise the estimate. Shared by the ferry-status snapshot and the
 * ferry-line callout so the widget, the nav, and /ferry all agree.
 */
export async function getEffectiveBoardingPass(
  now: Date = new Date(),
): Promise<BoardingPassStatus> {
  const override = await getBoardingPassOverride(now);
  if (override) {
    return {
      active: override.active,
      reason: override.active
        ? "Boarding pass ON — set by Chamber staff for today (reverts overnight)."
        : "Boarding pass OFF — set by Chamber staff for today (reverts overnight).",
      source: "override",
    };
  }
  return getBoardingPassStatus(now);
}
