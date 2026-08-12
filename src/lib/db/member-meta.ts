// SQL for member_meta (directory-public slice). Same layering as claim-store:
// domain rules live above (ranking in src/lib/directory/rank.ts, phase 2);
// this module owns the queries. No next/headers — scripts drive it directly.
//
// PRIVACY: dues_amount is ranking input, never display output. Nothing here
// may be re-exported toward a client bundle, and no caller may serialize
// rows into a response — public surfaces consume only orderings and the
// member-or-not fact derived server-side.

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import { memberMeta, type MemberMetaRow } from "./member-schema";

export type { MemberMetaRow };

export interface MemberMetaInput {
  subjectStore: string;
  subjectId: string;
  memberStatus: string;
  levelName?: string | null;
  duesAmount?: number | null;
  source: string;
  createdBy: string;
}

/** Normalized lowercase status, the only stored/compared form. */
function normStatus(s: string): string {
  return s.trim().toLowerCase();
}

/** Idempotent bulk load: a re-import updates status/level/dues in place —
 *  the roster is the source of truth for this table, so unlike
 *  claim_contact the newest import WINS. Returns rows written. */
export async function upsertMemberMeta(rows: MemberMetaInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows
    .map((r) => ({
      subjectStore: r.subjectStore,
      subjectId: r.subjectId,
      memberStatus: normStatus(r.memberStatus),
      levelName: r.levelName?.trim() || null,
      duesAmount:
        r.duesAmount !== undefined && r.duesAmount !== null && Number.isFinite(r.duesAmount)
          ? r.duesAmount.toFixed(2)
          : null,
      source: r.source,
      createdBy: r.createdBy,
    }))
    .filter((r) => r.memberStatus !== "");
  if (values.length === 0) return 0;
  const written = await getDb()
    .insert(memberMeta)
    .values(values)
    .onConflictDoUpdate({
      target: [memberMeta.subjectStore, memberMeta.subjectId],
      set: {
        memberStatus: sql`excluded.member_status`,
        levelName: sql`excluded.level_name`,
        duesAmount: sql`excluded.dues_amount`,
        source: sql`excluded.source`,
        createdBy: sql`excluded.created_by`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: memberMeta.subjectId });
  return written.length;
}

/** Everything for one store — the ranking read (server-side only). */
export async function listMemberMeta(subjectStore: string): Promise<MemberMetaRow[]> {
  return getDb().select().from(memberMeta).where(eq(memberMeta.subjectStore, subjectStore));
}

/** Seed-reset / hygiene. */
export async function deleteMemberMeta(
  subjectStore: string,
  subjectIds: string[],
): Promise<number> {
  if (subjectIds.length === 0) return 0;
  const gone = await getDb()
    .delete(memberMeta)
    .where(
      and(
        eq(memberMeta.subjectStore, subjectStore),
        inArray(memberMeta.subjectId, subjectIds),
      ),
    )
    .returning({ id: memberMeta.subjectId });
  return gone.length;
}

/** "Is this listing an active member?" — prefix-matched the same way the
 *  importer's status filter works ('active' matches 'Active', 'Active -
 *  Courtesy' does not match 'courtesy' etc.). */
export function isActiveMemberStatus(status: string | null | undefined): boolean {
  return normStatus(status ?? "").startsWith("active");
}
