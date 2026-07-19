// Portal-editable nonprofit orgs and volunteer needs.
// Seed data ships in src/lib/data/charities.ts; portal edits overlay it.

import type { Charity, VolunteerNeed } from "../types";
import { charities as charitySeed, volunteerNeeds as needSeed } from "../data/charities";
import {
  readMerged,
  readMergedAdmin,
  writeOverlayRecord,
  type WithStatus,
  type WriteMeta,
} from "./json-store";

const ORG_STORE = "charities";
const NEED_STORE = "volunteer-needs";

export async function getCharities(): Promise<Charity[]> {
  return readMerged<Charity>(ORG_STORE, charitySeed);
}

export async function getCharity(id: string): Promise<Charity | undefined> {
  return (await getCharities()).find((c) => c.id === id);
}

/** PRIVILEGED (E08): every status, status surfaced — admin surfaces only. */
export async function getCharitiesAdmin(): Promise<WithStatus<Charity>[]> {
  return readMergedAdmin<Charity>(ORG_STORE, charitySeed);
}

export async function saveCharity(record: Charity, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(ORG_STORE, record, meta);
}

export async function getVolunteerNeeds(): Promise<VolunteerNeed[]> {
  const all = await readMerged<VolunteerNeed>(NEED_STORE, needSeed);
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

/** PRIVILEGED (E08): every status, status surfaced — admin surfaces only. */
export async function getVolunteerNeedsAdmin(): Promise<WithStatus<VolunteerNeed>[]> {
  const all = await readMergedAdmin<VolunteerNeed>(NEED_STORE, needSeed);
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

/** Owner-scoped read (E08): one org's needs including its pending
 *  submissions, status surfaced. Admin drafts stay invisible to the owner. */
export async function getVolunteerNeedsForCharity(
  charityId: string,
): Promise<WithStatus<VolunteerNeed>[]> {
  const all = await readMergedAdmin<VolunteerNeed>(NEED_STORE, needSeed, {
    statuses: ["live", "pending"],
  });
  return all
    .filter((n) => n.charityId === charityId)
    .sort((a, b) => a.date.localeCompare(b.date));
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
