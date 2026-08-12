// Directory-public slice, phase 1 (data): member_meta planning + storage,
// dues parsing, the lat/lng schema contract, and directory's membership in
// the moderation set — including the full hold→approve loop that was
// impossible before directory joined ADMIN_GETTERS (items could be created
// but never approved).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildMemberMetaRows,
  parseDuesAmount,
  rosterFromCsv,
  planGrowthZoneImport,
} from "@/lib/import/growthzone";
import type { QwickPlan } from "@/lib/import/qwick";
import {
  isActiveMemberStatus,
  listMemberMeta,
  upsertMemberMeta,
} from "@/lib/db/member-meta";
import { directoryListingSchema } from "@/lib/schemas/directory";
import {
  approveModerationItem,
  holdEditProposal,
  MODERATED_STORES,
} from "@/lib/moderation";
import {
  getDirectoryListings,
  getDirectoryListingsAdmin,
  saveDirectoryListing,
} from "@/lib/stores/directory-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import type { DirectoryListing } from "@/lib/types";
import { createTestDb, type TestDb } from "../setup/pglite-db";

/* ----------------------------- pure planning ----------------------------- */

describe("parseDuesAmount", () => {
  it("reads money cells however the roster formats them", () => {
    expect(parseDuesAmount("$375.00")).toBe(375);
    expect(parseDuesAmount("1,234.50")).toBe(1234.5);
    expect(parseDuesAmount("160")).toBe(160);
    expect(parseDuesAmount(" $ 550 ")).toBe(550);
  });
  it("reads unknowns as null, never zero — unknown must rank below cheapest", () => {
    expect(parseDuesAmount("")).toBeNull();
    expect(parseDuesAmount("N/A")).toBeNull();
    expect(parseDuesAmount("-5")).toBeNull();
  });
});

const META_CSV = [
  "Member ID,Member Name,Membership Status,Membership Level,Annual Dues,Business Categories",
  "3001,Harbor Kayaks,Active,Medium Business,$375.00,Recreation",
  "3002,Quiet Books,Active,,,Retail",
  "3003,Partner Org,Active - Courtesy,Courtesy,$0,Non-Profit Organizations",
].join("\n");

describe("buildMemberMetaRows", () => {
  const roster = rosterFromCsv(META_CSV, {
    includeStatuses: ["active"],
  });
  const plan = planGrowthZoneImport(roster, [], []);

  it("carries status/level/dues per included plan row", () => {
    const rows = buildMemberMetaRows(plan, roster);
    const byName = new Map(rows.map((r) => [r.subjectId, r]));
    const kayaks = [...byName.values()].find((r) => r.subjectId.includes("harbor"));
    expect(kayaks).toMatchObject({
      subjectStore: "directory",
      memberStatus: "Active",
      levelName: "Medium Business",
      duesAmount: 375,
    });
    const books = [...byName.values()].find((r) => r.subjectId.includes("quiet"));
    expect(books).toMatchObject({ levelName: null, duesAmount: null });
    // Prefix statuses ride verbatim; normalization happens at the store.
    const partner = [...byName.values()].find((r) => r.subjectId.includes("partner"));
    expect(partner?.memberStatus).toBe("Active - Courtesy");
  });

  it("marks vanished listings dropped via the deletedUpstream bucket", () => {
    const withGone: QwickPlan = {
      ...plan,
      deletedUpstream: [{ store: "directory", id: "gone-books" }] as QwickPlan["deletedUpstream"],
    };
    const rows = buildMemberMetaRows(withGone, roster);
    const gone = rows.find((r) => r.subjectId === "gone-books");
    expect(gone).toMatchObject({ memberStatus: "dropped", duesAmount: null });
  });
});

describe("isActiveMemberStatus", () => {
  it("prefix-matches active, refuses everything else", () => {
    expect(isActiveMemberStatus("active")).toBe(true);
    expect(isActiveMemberStatus("Active - Courtesy")).toBe(true);
    expect(isActiveMemberStatus("courtesy")).toBe(false);
    expect(isActiveMemberStatus("dropped")).toBe(false);
    expect(isActiveMemberStatus(null)).toBe(false);
  });
});

/* -------------------------- lat/lng schema rules -------------------------- */

describe("directory schema coordinates", () => {
  const base = {
    id: "pin-test",
    name: "Pin Test",
    category: "shop",
    description: "",
    tags: [],
  };

  it("accepts both, treats empty strings as absent", () => {
    expect(directoryListingSchema.safeParse({ ...base, lat: 47.79, lng: -122.49 }).success).toBe(true);
    const parsed = directoryListingSchema.safeParse({ ...base, lat: "", lng: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lat).toBeUndefined();
      expect(parsed.data.lng).toBeUndefined();
    }
  });

  it("refuses a half-set coordinate", () => {
    expect(directoryListingSchema.safeParse({ ...base, lat: 47.79 }).success).toBe(false);
    expect(directoryListingSchema.safeParse({ ...base, lng: -122.49 }).success).toBe(false);
  });
});

/* --------------------------- PGlite-backed paths -------------------------- */

describe("member_meta store + directory moderation loop", () => {
  let tdb: TestDb;
  beforeAll(async () => {
    tdb = await createTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("upserts newest-wins and normalizes status/dues", async () => {
    const row = {
      subjectStore: "directory",
      subjectId: "harbor-kayaks",
      memberStatus: "Active",
      levelName: "Medium Business",
      duesAmount: 375,
      source: "test",
      createdBy: "test",
    };
    expect(await upsertMemberMeta([row])).toBe(1);
    let [stored] = await listMemberMeta("directory");
    expect(stored.memberStatus).toBe("active"); // normalized lowercase
    expect(stored.duesAmount).toBe("375.00");

    // Re-import with new numbers: the roster wins.
    await upsertMemberMeta([{ ...row, memberStatus: "Dropped", duesAmount: null }]);
    [stored] = await listMemberMeta("directory");
    expect(stored.memberStatus).toBe("dropped");
    expect(stored.duesAmount).toBeNull();
    expect(await listMemberMeta("directory")).toHaveLength(1);
  });

  it("directory is a moderated store, and hold→approve actually lands an edit", async () => {
    expect(MODERATED_STORES).toContain("directory");

    const listing: DirectoryListing = {
      id: "quiet-books",
      name: "Quiet Books",
      category: "shop",
      description: "Used books, quiet corners.",
      tags: [],
    };
    await saveDirectoryListing(listing, { actor: "admin@test", source: "admin", status: "live" });

    // Owner proposes an edit: live record must not move until approval.
    await holdEditProposal(
      "directory",
      { ...listing, description: "Used and rare books." },
      listing.name,
      { id: "user-1", email: "owner@test" },
    );
    let [live] = await getDirectoryListings();
    expect(live.description).toBe("Used books, quiet corners.");

    const [item] = (
      await listWorklistItems({ type: "moderation", subjectStore: "directory" })
    ).filter((i) => i.subjectId === listing.id);
    expect(item).toBeDefined();

    // The approval that was impossible before directory joined ADMIN_GETTERS.
    await approveModerationItem(item, { id: "admin-1", email: "admin@test" });
    [live] = await getDirectoryListings();
    expect(live.description).toBe("Used and rare books.");
    const [adminRow] = await getDirectoryListingsAdmin();
    expect(adminRow.status).toBe("live");
  });
});
