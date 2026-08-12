// Directory ranking (directory-public slice, phase 2) — the birth of the
// rankListings() choke point the E19 comments reserve (src/lib/auth/authz.ts
// names it alongside can(), resolveMapView(), and feed keys).
//
// The order (Mat, 2026-08-12): ACTIVE members first, bigger dues higher,
// alphabetical tiebreak. Courtesy and dropped members rank below active
// members but above nothing else — they are still listed (the additive-only
// invariant: lapsing never unpublishes), they just sink.
//
// RANK_BY_DUES exists because dues-ranked placement is the graduated-benefits
// pattern the WA B&O caveat targets (RCW 82.04.4282 / DOR ETA 3230.2021 —
// docs/DIRECTORY-PUBLIC.md): if the Chamber's bookkeeper walks it back, flip
// this to false and the order becomes member-then-alphabetical with no other
// change. Dues amounts are ranking INPUT only — no caller may render them.
//
// Pure and side-effect-free by design, like the hours helpers: callers pass
// listings and the member_meta rows; nothing here touches the database.

import { isActiveMemberStatus, type MemberMetaRow } from "@/lib/db/member-meta";

export const RANK_BY_DUES = true;

export interface RankedDirectoryListing<T extends { id: string; name: string }> {
  listing: T;
  /** Active paying member — the public badge and the primary sort key. */
  isMember: boolean;
}

/** Sort listings for the public directory. Stable and total:
 *  member desc → dues desc (unknown ranks below any known amount, when
 *  RANK_BY_DUES) → name asc (locale-aware). */
export function rankDirectoryListings<T extends { id: string; name: string }>(
  listings: readonly T[],
  meta: readonly MemberMetaRow[],
): RankedDirectoryListing<T>[] {
  const metaById = new Map(meta.map((m) => [m.subjectId, m]));
  const duesOf = (id: string): number | null => {
    const raw = metaById.get(id)?.duesAmount;
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return listings
    .map((listing) => ({
      listing,
      isMember: isActiveMemberStatus(metaById.get(listing.id)?.memberStatus),
    }))
    .sort((a, b) => {
      if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
      if (RANK_BY_DUES) {
        const da = duesOf(a.listing.id);
        const db = duesOf(b.listing.id);
        if (da !== db) {
          if (da === null) return 1;
          if (db === null) return -1;
          return db - da;
        }
      }
      return a.listing.name.localeCompare(b.listing.name, "en");
    });
}
