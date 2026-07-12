// Portal-editable nonprofit orgs and volunteer needs.
// Seed data ships in src/lib/data/charities.ts; portal edits overlay it.

import type { Charity, VolunteerNeed } from "../types";
import { charities as charitySeed, volunteerNeeds as needSeed } from "../data/charities";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const ORG_STORE = "charities";
const NEED_STORE = "volunteer-needs";

export async function getCharities(): Promise<Charity[]> {
  return readMerged<Charity>(ORG_STORE, charitySeed);
}

export async function getCharity(id: string): Promise<Charity | undefined> {
  return (await getCharities()).find((c) => c.id === id);
}

export async function saveCharity(record: Charity, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(ORG_STORE, record, meta);
}

export async function getVolunteerNeeds(): Promise<VolunteerNeed[]> {
  const all = await readMerged<VolunteerNeed>(NEED_STORE, needSeed);
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveVolunteerNeed(record: VolunteerNeed, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(NEED_STORE, record, meta);
}

export async function deleteVolunteerNeed(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(
    NEED_STORE,
    { id, _deleted: true } as VolunteerNeed & { _deleted: true },
    meta,
  );
}
