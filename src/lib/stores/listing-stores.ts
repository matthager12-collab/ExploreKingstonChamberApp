// Admin-editable "listing" domains: lodging, webcams, and ATMs.
// Three small overlay stores in one file — each merges its git-checked seed
// array with the custom overlay (custom-wins-by-id, { _deleted: true }
// tombstones hide seed records). Backed by json-store, so the file/DB seam
// is already handled.
//
// Note on ATMs: src/lib/data/atms.ts also exports an `atmMeta` map (badges,
// routes, confidence) keyed by ATM id. That metadata is NOT part of the Atm
// type and is not round-trippable through the overlay/editor, so getAtms()
// deliberately returns plain Atm records; the parking page keeps its own
// `atmMeta[atm.id]` lookup, which continues to work for seed ids and is
// simply absent (already optional in the UI) for admin-created ATMs.

import type { Atm, Lodging, Webcam } from "../types";
import { lodging as lodgingSeed } from "../data/lodging";
import { webcams as webcamSeed } from "../data/webcams";
import { atms as atmSeed } from "../data/atms";
import { readMerged, writeOverlayRecord } from "./json-store";

const LODGING_STORE = "lodging";
const WEBCAM_STORE = "webcams";
const ATM_STORE = "atms";

/* ---------------------------------- Lodging --------------------------------- */

export async function getLodging(): Promise<Lodging[]> {
  return readMerged<Lodging>(LODGING_STORE, lodgingSeed);
}

export async function saveLodging(record: Lodging): Promise<void> {
  await writeOverlayRecord(LODGING_STORE, record);
}

export async function deleteLodging(id: string): Promise<void> {
  await writeOverlayRecord(LODGING_STORE, { id, _deleted: true } as Lodging & {
    _deleted: true;
  });
}

/* ---------------------------------- Webcams --------------------------------- */

export async function getWebcams(): Promise<Webcam[]> {
  return readMerged<Webcam>(WEBCAM_STORE, webcamSeed);
}

export async function saveWebcam(record: Webcam): Promise<void> {
  await writeOverlayRecord(WEBCAM_STORE, record);
}

export async function deleteWebcam(id: string): Promise<void> {
  await writeOverlayRecord(WEBCAM_STORE, { id, _deleted: true } as Webcam & {
    _deleted: true;
  });
}

/* ------------------------------------ ATMs ---------------------------------- */

export async function getAtms(): Promise<Atm[]> {
  return readMerged<Atm>(ATM_STORE, atmSeed);
}

export async function saveAtm(record: Atm): Promise<void> {
  await writeOverlayRecord(ATM_STORE, record);
}

export async function deleteAtm(id: string): Promise<void> {
  await writeOverlayRecord(ATM_STORE, { id, _deleted: true } as Atm & {
    _deleted: true;
  });
}
