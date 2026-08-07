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

import { getCharities } from "@/lib/stores/charity-store";
import {
  anonymizeSignupsByEmail,
  findSignupsByEmail,
} from "@/lib/db/volunteer-signups";
import {
  anonymizeInvitesByEmail,
  anonymizeUser,
  findInvitesByEmail,
  findUserByEmail,
  listUsers,
} from "@/lib/db/auth-store";
import {
  isUnderLegalHold,
  rekeyRecordActor,
  scrubRecordDocFields,
} from "@/lib/db/privacy-delete";
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
    // FR-A92: a legal hold on the person's actual account record overrides
    // consumer deletion — refuse and report, never anonymize.
    if (await isUnderLegalHold("users", u.id)) {
      return { store: "users", affected: 0, note: "account under legal hold — not anonymized (FR-A92)" };
    }
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
      // NEVER the `code` — it is a live bearer redemption token (like a
      // password hash, excluded above). Report that an invite exists.
      records: rows.map((i) => ({
        role: i.role,
        email: i.email,
        note: i.note,
        expiresAt: i.expiresAt,
        pendingInvite: true,
      })),
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
    let scrubbed = 0;
    let held = 0;
    for (const c of rows) {
      if (await isUnderLegalHold("charities", c.id)) {
        held++;
        continue;
      }
      // Metadata-only scrub (NOT saveCharity → writeRecord, which would
      // snapshot the email into the immortal audit table).
      await scrubRecordDocFields("charities", c.id, ["contactEmail"], actor);
      scrubbed++;
    }
    return {
      store: "charities",
      affected: scrubbed,
      note: held > 0 ? `${held} under legal hold — not scrubbed (FR-A92)` : undefined,
    };
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

// E20: volunteer signups — name + one contact string, retention-limited.
const volunteerSignups: PiiStore = {
  store: "volunteer_signup",
  description:
    "Volunteer shift signups: a name and ONE contact string (email or phone). " +
    "Anonymized 45 days after the shift date by the volunteer sweep " +
    "(state kept for aggregate no-show stats). Phone-contact rows have no " +
    "email identifier, so this lookup cannot reach them — the sweep is what " +
    "bounds their lifetime.",
  hasEmailIdentifier: true,
  async findByIdentifier(email) {
    return findSignupsByEmail(email);
  },
  async exportRecords(email) {
    const rows = await findSignupsByEmail(email);
    return {
      store: "volunteer_signup",
      records: rows.map((r) => ({
        id: r.id,
        shiftId: r.shiftId,
        name: r.name,
        contact: r.contact,
        state: r.state,
        createdAt: r.createdAt,
      })),
    };
  },
  async deleteOrAnonymize(email, actor) {
    const affected = await anonymizeSignupsByEmail(email, actor);
    return {
      store: "volunteer_signup",
      affected,
      note: "Anonymized (name/contact removed; the signup's slot accounting is preserved).",
    };
  },
};

export const PII_STORES: PiiStore[] = [
  users,
  invites,
  charities,
  volunteerSignups,
  worklistContacts,
  noIdentifierStore(
    "hunt-submissions",
    "Scavenger-hunt photos + optional check-in location.",
    "Hunt submissions carry no account identifier — they are looked up by the submission id/date the requester supplies, then deleted via the retention/fulfillment path (photo first, then the row).",
  ),
  noIdentifierStore(
    "event_going",
    "\u201cI\u2019m going\u201d tallies: a count per event and self-reported ZIP.",
    "A counter, not a log \u2014 there is no row per visitor, no session id, and no coordinate, so no field ties a tap to a person. Nothing to find, export, or delete by identifier.",
  ),
  noIdentifierStore(
    "survey_response",
    "Anonymous LTAC visitor-survey answers.",
    "Structurally anonymous — no field ties a survey response to a person, so there is nothing to find, export, or delete by identifier.",
  ),
  noIdentifierStore(
    "feedback_response",
    "In-app page feedback: a 1–5 star rating, an open comment, and the page it was sent from.",
    // Deliberately a different explanation from the survey's. The survey is
    // anonymous by CONSTRUCTION — there is no free-text field to hide in. This
    // store has no identifier FIELD, but its comment is unstructured text a
    // visitor can type anything into, so an honest answer says the lookup is
    // impossible rather than implying the store is provably clean. The 12-month
    // window (the shortest published) is what actually bounds that exposure.
    "The feedback form collects no name, email, or device identifier, so there is no key to search by — a comment can only be located by its own wording. If you recognise text you wrote, quote it in your request and the Chamber will find and delete that row by hand; otherwise everything here is deleted automatically 12 months after it was sent.",
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
