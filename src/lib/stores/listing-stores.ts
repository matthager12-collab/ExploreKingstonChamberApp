// Admin-editable "listing" domains: lodging and webcams.
// Two small overlay stores in one file — each merges its git-checked seed
// array with the custom overlay (custom-wins-by-id, { _deleted: true }
// tombstones hide seed records). Backed by json-store, so the file/DB seam
// is already handled.

import type { Lodging, Webcam } from "../types";
import { lodging as lodgingSeed } from "../data/lodging";
import { webcams as webcamSeed } from "../data/webcams";
import { readMerged, writeOverlayRecord } from "./json-store";

const LODGING_STORE = "lodging";
const WEBCAM_STORE = "webcams";

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
