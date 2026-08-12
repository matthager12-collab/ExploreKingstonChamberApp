// The directory ranking law (directory-public slice, phase 2): active
// members first, bigger dues higher, alphabetical tiebreak — and the fine
// print that keeps it honest: unknown dues rank below any known amount,
// courtesy/dropped members rank as non-members, and filtering concerns are
// the caller's (the function is pure and total).

import { describe, expect, it } from "vitest";

import type { MemberMetaRow } from "@/lib/db/member-meta";
import { rankDirectoryListings } from "@/lib/directory/rank";

function meta(
  subjectId: string,
  memberStatus: string,
  duesAmount: string | null = null,
): MemberMetaRow {
  return {
    subjectStore: "directory",
    subjectId,
    memberStatus,
    levelName: null,
    duesAmount,
    source: "test",
    createdBy: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const listing = (id: string, name: string) => ({ id, name });

describe("rankDirectoryListings", () => {
  it("orders member → dues desc → alphabetical, unknowns last within members", () => {
    const ranked = rankDirectoryListings(
      [
        listing("small", "Aardvark Small"),
        listing("big", "Zebra Big"),
        listing("unknown-dues", "Middle Unknown"),
        listing("non-member", "Aaa Nonmember"),
      ],
      [
        meta("small", "active", "160.00"),
        meta("big", "active", "550.00"),
        meta("unknown-dues", "active", null),
      ],
    );
    expect(ranked.map((r) => r.listing.id)).toEqual([
      "big", // member, biggest dues
      "small", // member, smaller dues
      "unknown-dues", // member, dues unknown — below any known amount
      "non-member", // no meta at all
    ]);
    expect(ranked.map((r) => r.isMember)).toEqual([true, true, true, false]);
  });

  it("ties on dues break alphabetically, case- and accent-insensitively", () => {
    const ranked = rankDirectoryListings(
      [
        listing("z", "zebra shop"),
        listing("c", "Café Amélie"),
        listing("a", "Anchor Books"),
      ],
      [meta("z", "active", "160.00"), meta("c", "active", "160.00"), meta("a", "active", "160.00")],
    );
    expect(ranked.map((r) => r.listing.id)).toEqual(["a", "c", "z"]);
  });

  it("courtesy and dropped members rank as non-members, alphabetically", () => {
    const ranked = rankDirectoryListings(
      [
        listing("dropped", "Alpha Dropped"),
        listing("courtesy", "Beta Courtesy"),
        listing("paying", "Zulu Paying"),
      ],
      [
        meta("dropped", "dropped"),
        meta("courtesy", "active - courtesy"),
        meta("paying", "active", "115.00"),
      ],
    );
    expect(ranked.map((r) => r.listing.id)).toEqual(["paying", "dropped", "courtesy"]);
    expect(ranked[0].isMember).toBe(true);
    expect(ranked[1].isMember).toBe(false);
    expect(ranked[2].isMember).toBe(false);
  });

  it("is stable for identical keys and total over empty meta", () => {
    const ranked = rankDirectoryListings(
      [listing("b", "Same Name"), listing("a", "Same Name")],
      [],
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => !r.isMember)).toBe(true);
  });
});
