// Admin on/off switch and settings for the ferry-dock KIOSK (E22).
//
// This is the kiosk's ONLY store, and it holds settings — never content. The
// kiosk renders the same moderated records the website does (restaurants,
// events, lodging, parking zones, the ferry snapshot), which is the whole point
// of building it inside this app instead of buying another hosted platform: an
// admin edits a listing once and the kiosk reflects it within the ISR window,
// with no deploy and no per-device push (docs/KIOSK.md §2, §6). A second content
// store here would recreate exactly the "content lives somewhere else and has to
// be synced" problem the Chamber is leaving Qwick to escape.
//
// Storage: the same overlay seam as ferry-prediction-store — one record, id
// "settings", in store "kiosk". No seed, so absence = OFF and the kiosk ships
// dark until the Chamber flips it on with the device physically on site.

import { getSessionUser } from "../auth";
import { clampIdleSeconds, DEFAULT_IDLE_SECONDS } from "../kiosk/limits";
import {
  DEFAULT_ENABLED_SCREENS,
  isKioskScreenId,
  type KioskScreenId,
} from "../kiosk/screens";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "kiosk";
const RECORD_ID = "settings";

export interface KioskSettingsRecord {
  id: typeof RECORD_ID;
  /** Whether /kiosk answers the public. Absent record = false. */
  enabled: boolean;
  /** ISO timestamp it was last changed, for the admin display. */
  setAt: string;
  /** Who changed it (name or email), for the admin display. */
  setBy: string;
  /** Which category screens get a tile. Order comes from the catalogue. */
  enabledScreens: KioskScreenId[];
  /** Idle seconds before the attract loop takes back over. */
  idleSeconds: number;
}

export interface KioskSettings {
  enabled: boolean;
  enabledScreens: KioskScreenId[];
  idleSeconds: number;
  /** Null until an admin has saved once — drives the "never configured" copy. */
  setAt: string | null;
  setBy: string | null;
}

/** Defaults, used when no record exists AND to fill gaps in a partial one. */
function defaults(): KioskSettings {
  return {
    enabled: false,
    enabledScreens: [...DEFAULT_ENABLED_SCREENS],
    idleSeconds: DEFAULT_IDLE_SECONDS,
    setAt: null,
    setBy: null,
  };
}

/** The raw stored record, or null when never set. */
export async function getKioskSettingRecord(): Promise<KioskSettingsRecord | null> {
  const rows = await readMerged<KioskSettingsRecord>(STORE, []);
  return rows.find((r) => r.id === RECORD_ID) ?? null;
}

/**
 * Effective settings — always a complete object.
 *
 * Every field is re-validated on the way OUT, not just on the way in. The
 * record is a loose overlay document that a restore, a hand-edited import, or
 * an older build could have written, and this value configures an unattended
 * device: a junk idleSeconds of 0 would reset the screen faster than anyone
 * could read it, and a screen id that no longer exists would render a tile
 * leading to a 404 with no browser chrome to escape it.
 */
export async function getKioskSettings(): Promise<KioskSettings> {
  const rec = await getKioskSettingRecord();
  if (!rec) return defaults();
  const screens = Array.isArray(rec.enabledScreens)
    ? rec.enabledScreens.filter(isKioskScreenId)
    : [...DEFAULT_ENABLED_SCREENS];
  return {
    enabled: rec.enabled === true,
    // An empty list would leave the attract screen with no tiles at all — a
    // kiosk that cannot be used. Fall back rather than render a dead end.
    enabledScreens: screens.length > 0 ? screens : [...DEFAULT_ENABLED_SCREENS],
    idleSeconds: clampIdleSeconds(rec.idleSeconds),
    setAt: typeof rec.setAt === "string" ? rec.setAt : null,
    setBy: typeof rec.setBy === "string" ? rec.setBy : null,
  };
}

/** Whether /kiosk is live to the public. Defaults to OFF. */
export async function getKioskEnabled(): Promise<boolean> {
  return (await getKioskSettings()).enabled;
}

export interface KioskAccess {
  /** True when the kiosk route is live for everyone. */
  enabled: boolean;
  /** True when it is off publicly but the current admin may preview it. */
  adminPreview: boolean;
  settings: KioskSettings;
}

/**
 * Resolve whether the current request may see the kiosk.
 *
 * THE ORDER OF THESE TWO READS IS LOAD-BEARING, not stylistic. getSessionUser()
 * reads cookies(), and a cookies() read on the ENABLED path would make /kiosk
 * dynamic for the one client that matters — the wall-mounted panel, which holds
 * the page open for hours and depends on ISR plus its idle freshness reload to
 * pick up admin edits. So the flag is checked FIRST and the session is only
 * consulted on the disabled branch, where the visitor is by definition a signed-
 * in admin previewing before go-live and per-request rendering is free.
 *
 * Same shape as getFerryPredictionAccess(); `visible = enabled || adminPreview`.
 */
export async function getKioskAccess(): Promise<KioskAccess> {
  const settings = await getKioskSettings();
  if (settings.enabled) return { enabled: true, adminPreview: false, settings };
  const user = await getSessionUser();
  return { enabled: false, adminPreview: user?.role === "admin", settings };
}

export interface KioskSettingsInput {
  enabled?: unknown;
  enabledScreens?: unknown;
  idleSeconds?: unknown;
}

/**
 * Write the settings record. Every field is normalised here as well as in
 * getKioskSettings — the API is the only caller today, but a store is a seam
 * and the next caller should not be able to persist an unusable kiosk.
 */
export async function setKioskSettings(
  input: KioskSettingsInput,
  setBy: string,
  meta?: WriteMeta,
): Promise<KioskSettings> {
  const current = await getKioskSettings();
  const screens = Array.isArray(input.enabledScreens)
    ? input.enabledScreens.filter(isKioskScreenId)
    : current.enabledScreens;
  const record: KioskSettingsRecord = {
    id: RECORD_ID,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    enabledScreens: screens.length > 0 ? screens : [...DEFAULT_ENABLED_SCREENS],
    idleSeconds:
      input.idleSeconds === undefined
        ? current.idleSeconds
        : clampIdleSeconds(input.idleSeconds),
    setAt: new Date().toISOString(),
    setBy,
  };
  await writeOverlayRecord<KioskSettingsRecord>(STORE, record, meta);
  return getKioskSettings();
}
