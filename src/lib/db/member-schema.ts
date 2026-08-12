// Membership metadata per listing (directory-public slice, 2026-08-12).
//
// WHY THIS TABLE EXISTS. The public directory ranks listings by membership:
// active members first, bigger dues higher, alphabetical tiebreak (Mat's
// decision 2026-08-12, all three confirmed). Ranking needs the roster's
// status and dues INSIDE the app database — a second deliberate, Mat-approved
// exception to the importer's original "membership levels, dues, contacts
// stay OUT of the app database" scope guard (the first was claim_contact).
// The plan of record (docs/ROLLOFF-GROWTHZONE.md §3) puts membership fields
// on the ORG eventually (E16 member store); this table is the LISTING-keyed
// interim that works while most listings have no org (unclaimed), and it is
// the migration source when E16 lands.
//
// Containment rules, same family as claim_contact:
//   - dues_amount is NEVER rendered anywhere, public or admin — the public
//     surface consumes only the ORDERING derived from it (and the member
//     badge derived from member_status);
//   - rows are written by the importer/seed scripts only, read server-side;
//     no API returns rows to a browser;
//   - provenance travels with every row (source + created_by).
//
// B&O note for the paper trail: dues-ranked placement is the "graduated
// benefits" pattern RCW 82.04.4282 / DOR ETA 3230.2021 targets — the
// Chamber's bookkeeper applies the allocation caveat (ROLLOFF-GROWTHZONE §3).
// The ranking comparator is deliberately config-flippable so a bookkeeper
// walk-back needs no schema change.

import { numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** One row per listing the roster knows about. */
export const memberMeta = pgTable(
  "member_meta",
  {
    /** Store name in the record vocabulary ("directory", "restaurants", …). */
    subjectStore: text("subject_store").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Normalized lowercase roster status: 'active' | 'courtesy' | 'dropped'
     *  | 'pending approval' | … — stored verbatim-lowercased, matched by
     *  prefix the same way the importer's status filter works. */
    memberStatus: text("member_status").notNull(),
    /** Roster level/type name, verbatim. Messy legacy vocabulary (half the
     *  2026 roster is blank) — display/debug only, never ranking. */
    levelName: text("level_name"),
    /** Annual dues total in dollars, from the roster's dues column. The
     *  ranking input. NULL = unknown, ranks below any known amount. */
    duesAmount: numeric("dues_amount", { precision: 10, scale: 2 }),
    /** Provenance: 'import:growthzone' | 'seed:claim-test' | 'admin'. */
    source: text("source").notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Re-imports upsert in place; one row per listing.
    uniqueIndex("member_meta_subject_uniq").on(t.subjectStore, t.subjectId),
  ],
);

export type MemberMetaRow = typeof memberMeta.$inferSelect;
