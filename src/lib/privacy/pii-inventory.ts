// E11 PII inventory — the typed manifest of EVERY store holding personal data,
// each with working find / export / delete handlers. Two jobs:
//
//   1. The engine behind the consumer access/delete workflow: an "access"
//      request runs exportRecords across the registry; a "delete" request
//      runs deleteOrAnonymize.
//   2. THE E16 TRIPWIRE. docs/PRIVACY.md's binding rule: no epic may add ANY
//      store containing personal data without registering it here — explicitly
//      including the native member store E16 (rewritten) builds. The coverage
//      test (pii-inventory.test.ts) is what reviewers check.
//
// Design notes:
//  - Stores that hold NO identifier (survey, analytics — structurally
//    anonymous by construction) are registered as explicit no-identifier
//    entries: a delete request against them is fulfilled by EXPLANATION, which
//    the fulfillment UI surfaces, not by a no-op that looks like data loss.
//  - Deletion for account holders ANONYMIZES rather than hard-deletes, and
//    re-keys referential uses (record.updated_by) to the opaque user id so the
//    audit trail's actor references don't dangle (D-11).

import { getCharities, saveCharity } from "@/lib/stores/charity-store";
import {
  anonymizeInvitesByEmail,
  anonymizeUser,
  findInvitesByEmail,
  findUserByEmail,
  listUsers,
} from "@/lib/db/auth-store";
import { rekeyRecordActor } from "@/lib/db/privacy-delete";
import { listWorklistItems } from "@/lib/db/worklist";

export interface PiiExport {
  store: string;
  /** The requester's records in this store (empty for no-identifier stores). */
  records: unknown[];
  /** Shown in the fulfillment UI — e.g. why a store returns nothing. */
  note?: string;
}

export interface PiiDeleteResult {
  store: string;
  /** Rows anonymized/scrubbed/deleted. */
  affected: number;
  note?: string;
}

export interface PiiStore {
  store: string;
  description: string;
  /** false = structurally anonymous or looked up by a non-email handle
   *  (documented) — the fulfillment UI explains rather than silently no-ops. */
  hasEmailIdentifier: boolean;
  findByIdentifier(email: string): Promise<unknown[]>;
  exportRecords(email: string): Promise<PiiExport>;
  deleteOrAnonymize(email: string, actor: string): Promise<PiiDeleteResult>;
}

const eq = (a: string | null | undefined, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

const users: PiiStore = {
  store: "users",
  description: "Portal account holders — email, display name, password hash.",
  hasEmailIdentifier: true,
  async findByIdentifier(email) {
    const u = await findUserByEmail(email);
    return u ? [u] : [];
  },
  async exportRecords(email) {
    const u = await findUserByEmail(email);
    return {
      store: "users",
      // Never the password hash — an access export is the person's own data,
      // not a credential dump.
      records: u
        ? [{ id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.orgId, createdAt: u.createdAt }]
        : [],
    };
  },
  async deleteOrAnonymize(email, actor) {
    const u = await findUserByEmail(email);
    if (!u) return { store: "users", affected: 0 };
    const opaqueId = await anonymizeUser(u.id, { actor, source: "admin" });
    // D-11: re-point mutable record.updated_by refs from the email to the
    // opaque id; the append-only audit.actor keeps the email (records floor).
    const rekeyed = opaqueId ? await rekeyRecordActor(u.email, opaqueId) : 0;
    return {
      store: "users",
      affected: 1,
      note: `account anonymized; ${rekeyed} record author reference(s) re-keyed to the opaque id (audit trail retains the acting email — see docs/PRIVACY.md)`,
    };
  },
};

const invites: PiiStore = {
  store: "invites",
  description: "Pending invite codes — may carry an invitee email + a note.",
  hasEmailIdentifier: true,
  async findByIdentifier(email) {
    return findInvitesByEmail(email);
  },
  async exportRecords(email) {
    const rows = await findInvitesByEmail(email);
    return {
      store: "invites",
      records: rows.map((i) => ({ code: i.code, email: i.email, role: i.role, note: i.note })),
    };
  },
  async deleteOrAnonymize(email, actor) {
    const n = await anonymizeInvitesByEmail(email, { actor, source: "admin" });
    return { store: "invites", affected: n };
  },
};

const charities: PiiStore = {
  store: "charities",
  description: "Charity/nonprofit listings — an optional public contact email.",
  hasEmailIdentifier: true,
  async findByIdentifier(email) {
    return (await getCharities()).filter((c) => eq(c.contactEmail, email));
  },
  async exportRecords(email) {
    const rows = (await getCharities()).filter((c) => eq(c.contactEmail, email));
    return {
      store: "charities",
      records: rows.map((c) => ({ id: c.id, name: c.name, contactEmail: c.contactEmail })),
    };
  },
  async deleteOrAnonymize(email, actor) {
    const rows = (await getCharities()).filter((c) => eq(c.contactEmail, email));
    for (const c of rows) {
      await saveCharity({ ...c, contactEmail: undefined }, { actor, source: "admin" });
    }
    return { store: "charities", affected: rows.length };
  },
};

const worklistContacts: PiiStore = {
  store: "worklist_item",
  description:
    "Privacy/accuracy request contacts held on OPEN worklist items (scrubbed automatically at resolution).",
  hasEmailIdentifier: true,
  async findByIdentifier(email) {
    // Scan active items whose payload carries a matching contact. Resolved
    // items are already scrubbed (redact-at-resolution), so this only ever
    // finds in-flight requests.
    const items = await listWorklistItems({ state: ["open", "in_progress"] });
    return items.filter((it) => payloadHasContact(it.payload, email));
  },
  async exportRecords(email) {
    const items = await listWorklistItems({ state: ["open", "in_progress"] });
    const mine = items.filter((it) => payloadHasContact(it.payload, email));
    return {
      store: "worklist_item",
      records: mine.map((it) => ({ id: it.id, type: it.type, state: it.state })),
      note: mine.length === 0 ? "no open requests reference this contact" : undefined,
    };
  },
  async deleteOrAnonymize(email) {
    // The contact is scrubbed when the item resolves; an open item is the
    // active request itself, which the admin fulfills. We report rather than
    // strip mid-flight (stripping would erase the way to answer the person).
    const items = await listWorklistItems({ state: ["open", "in_progress"] });
    const mine = items.filter((it) => payloadHasContact(it.payload, email));
    return {
      store: "worklist_item",
      affected: 0,
      note:
        mine.length > 0
          ? `${mine.length} open request(s) reference this contact; the contact is scrubbed automatically when each is resolved`
          : "no open requests reference this contact",
    };
  },
};

function payloadHasContact(payload: Record<string, unknown>, email: string): boolean {
  if (eq(payload.contact as string | undefined, email)) return true;
  if (Array.isArray(payload.messages)) {
    return (payload.messages as Record<string, unknown>[]).some((m) =>
      eq(m.contact as string | undefined, email),
    );
  }
  return false;
}

/** Structurally-anonymous / non-email stores: registered so the E16 rule and
 *  the coverage test see full coverage, and so a request against them is
 *  fulfilled by explanation, not a silent no-op. */
function noIdentifierStore(store: string, description: string, note: string): PiiStore {
  return {
    store,
    description,
    hasEmailIdentifier: false,
    async findByIdentifier() {
      return [];
    },
    async exportRecords() {
      return { store, records: [], note };
    },
    async deleteOrAnonymize() {
      return { store, affected: 0, note };
    },
  };
}

export const PII_STORES: PiiStore[] = [
  users,
  invites,
  charities,
  worklistContacts,
  noIdentifierStore(
    "hunt-submissions",
    "Scavenger-hunt photos + optional check-in location.",
    "Hunt submissions carry no account identifier — they are looked up by the submission id/date the requester supplies, then deleted via the retention/fulfillment path (photo first, then the row).",
  ),
  noIdentifierStore(
    "survey_response",
    "Anonymous LTAC visitor-survey answers.",
    "Structurally anonymous — no field ties a survey response to a person, so there is nothing to find, export, or delete by identifier.",
  ),
  noIdentifierStore(
    "analytics_event",
    "Anonymous page/outbound/geo-ping/consent events.",
    "Structurally anonymous — a per-browser session id that resets on close, no coordinates, no cross-session identifier. Nothing is retrievable by a personal identifier.",
  ),
  noIdentifierStore(
    "quarantine",
    "Importer-parked records that failed validation.",
    "Holds whole failed-import docs (may include legacy contact fields). No per-person identifier index; operators resolve it via the quarantine runbook, and it is covered by the vendor-exit export.",
  ),
];

/** All registered store ids — used by the coverage test and docs. */
export const PII_STORE_IDS = PII_STORES.map((s) => s.store);
