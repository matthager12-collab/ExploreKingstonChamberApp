// E17 step 6 — invite-mint refusal + redeem ownership backfill
// (M-10-02 / FR-A11: sub-minute claim, no orphaned half-accounts), over
// PGlite (real Postgres engine, checked-in migrations). What it pins:
//
//  - directory ids are mintable targets for member-business invites, and the
//    validation reads the ADMIN getter — imported DRAFTS are precisely what
//    gets claimed;
//  - minting over a record that already carries owner_org_id → 409 naming
//    the owning org (OwnershipConflictError, not the AuthError→400 path);
//  - a full mint→redeem round trip backfills owner_org_id onto every linked
//    record: an existing overlay row keeps its CURRENT status (the
//    writeRecord upsert trap — a claimed draft must stay a draft) and a
//    seed-only record gets a live overlay row; every write is audited;
//  - the charity path still mints org-editor/nonprofit and backfills into
//    the charities store;
//  - THE RACE: a record claimed between mint and redeem refuses with a 409
//    and creates NOTHING — no user row, no org row, no session cookie — and
//    the code is not burned, so it still works once the conflict is resolved.

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { charities as charitySeed } from "@/lib/data/charities";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { createOrg, getInvite, redeemInvite } from "@/lib/auth/identity";
import { readRecordRows, writeRecord } from "@/lib/db/records";
import { audit, orgs, users } from "@/lib/db/schema";
import { mintInvite } from "@/lib/invite-mint";
import { OwnershipConflictError } from "@/lib/ownership";
import { getDirectoryListings } from "@/lib/stores/directory-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const admin = vi.hoisted(() => ({
  id: "admin-1",
  role: "admin" as const,
  orgId: null,
  editableIds: [] as string[],
  entitlements: {},
  name: "Admin",
  email: "admin@example.test",
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireRole: vi.fn(async () => null),
    getSessionUser: vi.fn(async () => admin),
  };
});

import { POST as invitesPOST } from "@/app/api/portal/invites/route";
import { POST as redeemPOST } from "@/app/api/auth/redeem/route";

const ACTOR = "admin@example.test";

function jsonReq(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const cafeDoc = { ...restaurantSeed[0], id: "own-cafe", name: "Own Cafe" };
const cafe2Doc = { ...restaurantSeed[0], id: "own-cafe2", name: "Own Cafe Two" };
const raceDoc = { ...restaurantSeed[0], id: "own-race", name: "Race Cafe" };
const dirDoc = {
  id: "own-dir-shop",
  name: "Own Dir Shop",
  category: "shop",
  description: "Imported directory listing, still a draft",
  tags: [] as string[],
};

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  await writeRecord("restaurants", cafeDoc, { status: "live" });
  await writeRecord("restaurants", cafe2Doc, { status: "live" });
  await writeRecord("restaurants", raceDoc, { status: "live" });
  // The importer's landing state: a DRAFT, source import — exactly what a
  // claim invite points at.
  await writeRecord("directory", dirDoc, { status: "draft", source: "import" });
});
afterAll(async () => {
  await tdb.close();
});

describe("mint — directory targets and the ownership refusal", () => {
  it("mints a member-business invite linked to a directory DRAFT", async () => {
    const invite = await mintInvite(
      {
        role: "member-business",
        linkedIds: ["own-dir-shop"],
        newOrgName: "Own Dir Shop",
      },
      ACTOR,
    );
    expect(invite.role).toBe("member-business");
    expect(invite.linkedIds).toEqual(["own-dir-shop"]);
    expect(invite.newOrgKind).toBe("business");
  });

  it("still rejects an id in none of the business stores", async () => {
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["own-nope"], newOrgName: "X" },
        ACTOR,
      ),
    ).rejects.toThrow(/unknown business id\(s\): own-nope/);
  });

  it("refuses to mint over an already-owned record: 409 naming the owning org", async () => {
    const claimant = await createOrg(
      { name: "First Claimant LLC", kind: "business", linkedIds: ["own-cafe"] },
      ACTOR,
    );
    await writeRecord("restaurants", cafeDoc, {
      status: "live",
      ownerOrgId: claimant.id,
    });

    // Function level: the distinct error class (not AuthError → 400).
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["own-cafe"], newOrgName: "Second Claim" },
        ACTOR,
      ),
    ).rejects.toThrow(OwnershipConflictError);

    // Route level: 409, and the message names the record and the org.
    const res = await invitesPOST(
      jsonReq("/api/portal/invites", {
        role: "member-business",
        linkedIds: ["own-cafe"],
        newOrgName: "Second Claim",
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("own-cafe");
    expect(json.error).toContain("First Claimant LLC");
  });
});

describe("redeem — ownership backfill", () => {
  it("mint→redeem sets owner_org_id on overlay AND seed-only records, audited", async () => {
    const seedId = restaurantSeed[0].id;
    const invite = await mintInvite(
      {
        role: "member-business",
        linkedIds: ["own-cafe2", seedId],
        newOrgName: "Round Trip Holdings",
      },
      ACTOR,
    );

    const { user, org } = await redeemInvite(invite.code, {
      email: "rt@x.test",
      name: "RT",
      password: "password12",
    });
    expect(org).not.toBeNull();
    expect(user.orgId).toBe(org!.id);

    const rows = await readRecordRows("restaurants");
    // Overlay path: the existing row keeps its doc and its live status.
    const overlay = rows.find((r) => r.id === "own-cafe2");
    expect(overlay?.ownerOrgId).toBe(org!.id);
    expect(overlay?.status).toBe("live");
    expect(overlay?.source).toBe("portal");
    expect(overlay?.doc.name).toBe("Own Cafe Two");
    // Seed path: a curated restaurant with no overlay row gets one, live
    // (a seed IS live), built from the seed doc.
    const seeded = rows.find((r) => r.id === seedId);
    expect(seeded?.ownerOrgId).toBe(org!.id);
    expect(seeded?.status).toBe("live");
    expect(seeded?.source).toBe("portal");
    expect(seeded?.doc.name).toBe(restaurantSeed[0].name);

    // Both writes went through the choke point → audit rows, portal-sourced,
    // actor = the redeeming account.
    const trail = await tdb.db.select().from(audit).where(eq(audit.store, "restaurants"));
    const overlayAudit = trail.filter(
      (a) => a.recordId === "own-cafe2" && a.action === "update" && a.source === "portal",
    );
    const seedAudit = trail.filter(
      (a) => a.recordId === seedId && a.action === "create" && a.source === "portal",
    );
    expect(overlayAudit.length).toBeGreaterThanOrEqual(1);
    expect(overlayAudit[0].actor).toBe("rt@x.test");
    expect(seedAudit.length).toBeGreaterThanOrEqual(1);
    expect(seedAudit[0].actor).toBe("rt@x.test");
  });

  it("a claimed directory DRAFT stays a draft (the writeRecord upsert trap)", async () => {
    const invite = await mintInvite(
      {
        role: "member-business",
        linkedIds: ["own-dir-shop"],
        newOrgName: "Dir Shop Org",
      },
      ACTOR,
    );
    const { user } = await redeemInvite(invite.code, {
      email: "dir@x.test",
      name: "Dir Owner",
      password: "password12",
    });

    const row = (await readRecordRows("directory")).find((r) => r.id === "own-dir-shop");
    expect(row?.ownerOrgId).toBe(user.orgId);
    expect(row?.status).toBe("draft"); // NOT silently published
    expect(row?.source).toBe("portal");
    // Still invisible on the fail-closed public getter.
    expect((await getDirectoryListings()).map((d) => d.id)).not.toContain("own-dir-shop");
  });

  it("charity-linked mint still carries org-editor/nonprofit, and backfills into charities", async () => {
    const charityId = charitySeed[0].id;
    const res = await invitesPOST(
      jsonReq("/api/portal/invites", {
        role: "org-editor",
        linkedIds: [charityId],
        newOrgName: "Helpers",
      }),
    );
    expect(res.status).toBe(200);
    const { invite } = await res.json();
    expect(invite.role).toBe("org-editor");
    expect(invite.newOrgKind).toBe("nonprofit");

    const { user, org } = await redeemInvite(invite.code, {
      email: "np@x.test",
      name: "NP",
      password: "password12",
    });
    expect(org?.kind).toBe("nonprofit");
    const row = (await readRecordRows("charities")).find((r) => r.id === charityId);
    expect(row?.ownerOrgId).toBe(user.orgId);
    expect(row?.status).toBe("live");
  });
});

describe("THE RACE — claimed between mint and redeem", () => {
  it("refuses with 409 and creates NOTHING: no user, no org, no cookie; the code survives", async () => {
    const invite = await mintInvite(
      { role: "member-business", linkedIds: ["own-race"], newOrgName: "Racer Org" },
      ACTOR,
    );

    // Between mint and redeem, another org claims the listing.
    const interloper = await createOrg(
      { name: "Interloper LLC", kind: "business", linkedIds: ["own-race"] },
      ACTOR,
    );
    await writeRecord("restaurants", raceDoc, {
      status: "live",
      ownerOrgId: interloper.id,
    });

    const res = await redeemPOST(
      jsonReq("/api/auth/redeem", {
        code: invite.code,
        email: "race@x.test",
        name: "Racer",
        password: "password12",
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already been claimed/);
    // No session was minted for the refused redemption.
    expect(res.headers.get("set-cookie")).toBeNull();

    // No orphaned half-account: no user row, no org row.
    expect(
      await tdb.db.select().from(users).where(eq(users.email, "race@x.test")),
    ).toHaveLength(0);
    expect(
      await tdb.db.select().from(orgs).where(eq(orgs.name, "Racer Org")),
    ).toHaveLength(0);

    // The refusal happened BEFORE the transaction — the code is not burned,
    // so once the Chamber resolves the conflict the same invite still works.
    const after = await getInvite(invite.code);
    expect(after?.usedBy).toBeNull();
    expect(after?.revokedAt).toBeNull();
  });
});
