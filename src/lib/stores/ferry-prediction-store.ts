// Admin on/off switch for the ferry busyness PREDICTION feature.
//
// The prediction (the /ferry/plan planner, the "How busy today" panel on /ferry,
// and the home planning callout) is an estimate we're validating before we trust
// it in front of visitors. This flag lets an admin hide it from the public while
// keeping it visible to signed-in admins for testing. It defaults to OFF, so the
// feature ships dark until the Chamber flips it on.
//
// Storage: the same overlay seam as boarding-pass-store — one record, id
// "settings", in store "ferry-prediction". No seed (absence = OFF).

import { getSessionUser } from "../auth";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "ferry-prediction";
const RECORD_ID = "settings";

interface FerryPredictionRecord {
  id: typeof RECORD_ID;
  enabled: boolean;
  /** ISO timestamp it was last changed, for the admin display. */
  setAt: string;
  /** Who changed it (name or email), for the admin display. */
  setBy: string;
}

/** The stored setting, or null when never set (treated as OFF). */
export async function getFerryPredictionSetting(): Promise<FerryPredictionRecord | null> {
  const rows = await readMerged<FerryPredictionRecord>(STORE, []);
  return rows.find((r) => r.id === RECORD_ID) ?? null;
}

/** Whether the prediction feature is shown to the public. Defaults to OFF. */
export async function getFerryPredictionEnabled(): Promise<boolean> {
  return (await getFerryPredictionSetting())?.enabled ?? false;
}

/** Turn the public prediction feature on or off. */
export async function setFerryPredictionEnabled(
  enabled: boolean,
  setBy: string,
  meta?: WriteMeta,
): Promise<void> {
  await writeOverlayRecord<FerryPredictionRecord>(
    STORE,
    {
      id: RECORD_ID,
      enabled,
      setAt: new Date().toISOString(),
      setBy,
    },
    meta,
  );
}

export interface FerryPredictionAccess {
  /** True when the feature is live for everyone. */
  enabled: boolean;
  /** True when it's off publicly but the current admin may preview it. */
  adminPreview: boolean;
}

/**
 * Resolve whether the current request should see the prediction feature.
 * Everyone sees it when enabled; when it's off, signed-in admins still get a
 * preview (so they can test/validate), and visitors get nothing.
 * `visible = enabled || adminPreview`.
 */
export async function getFerryPredictionAccess(): Promise<FerryPredictionAccess> {
  if (await getFerryPredictionEnabled()) return { enabled: true, adminPreview: false };
  const user = await getSessionUser();
  return { enabled: false, adminPreview: user?.role === "admin" };
}
