// E17 ownership LIFECYCLE — the way back out, and the two halves of a claim
// staying one truth. Over PGlite (real Postgres engine, checked-in
// migrations). Every test here pins a defect that shipped in slice 3:
//
//  1. owner_org_id was a ONE-WAY DOOR. Nothing in the product ever set it
//     back to null, while the mint refusal told the admin to "revoke that
//     organization's claim first" — an action that did not exist. A claim
//     minted to the wrong business bricked the listing forever.
//  2. A join-existing-org invite stamped owner_org_id but never extended the
//     existing org's linked_ids, so the invited user got a 403 on the very
//     listing they were invited to and every future mint 409'd.
//  3. "Is this claimed?" read owner_org_id ALONE. can() decides from
//     linked_ids, so a backfill that failed after the grant landed left a
//     listing that looked free while its owner could already edit it —
//     inviting a second, unrelated org over the same listing.
//  4. The backfill's bookkeeping was keyed by bare id, so an id present in
//     two of a kind's stores was stamped in only one of them.

import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import {
  createInvite,
  createOrg,
  getOrg,
  redeemInvite,
} from "@/lib/auth/identity";
import { readRecordRows, writeRecord } from "@/lib/db/records";
import { audit } from "@/lib/db/schema";
import { getClaimsConsoleRows } from "@/lib/claims/console-data";
import { mintInvite } from "@/lib/invite-mint";
import { backfillLinkedOwnership, OwnershipConflictError } from "@/lib/ownership";
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
    requireAdmin: vi.fn(async () => null),
    getSessionUser: vi.fn(async () => admin),
  };
});

import { POST as releasePOST } from "@/app/api/admin/claims/release/route";

const ACTOR = "admin@example.test";

function jsonReq(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function restaurant(id: string, name: string) {
  return { ...restaurantSeed[0], id, name };
}

function directory(id: string, name: string) {
  return {
    id,
    name,
    category: "shop",
    description: "Imported directory listing, still a draft",
    tags: [] as string[],
  };
}

async function rowFor(store: string, id: string) {
  return (await readRecordRows(store)).find((r) => r.id === id);
}

async function consoleRow(store: string, id: string) {
  return (await getClaimsConsoleRows()).find((r) => r.store === store && r.id === id);
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("release — the door that did not exist", () => {
  it("clears owner_org_id AND the org's linked_ids, auditing both halves", async () => {
    await writeRecord("restaurants", restaurant("rel-cafe", "Release Cafe"), {
      status: "live",
    });
    const org = await createOrg(
      { name: "Wrong Business LLC", kind: "business", linkedIds: ["rel-cafe", "keep-me"] },
      ACTOR,
    );
    await writeRecord("restaurants", restaurant("rel-cafe", "Release Cafe"), {
      status: "live",
      ownerOrgId: org.id,
    });

    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "restaurants", id: "rel-cafe" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // The response carries the console's OWN view of the new state.
    expect(json.row).toMatchObject({
      claimed: false,
      ownerOrgId: null,
      grantOrgs: [],
      mismatch: null,
    });
    expect(json.released).toMatchObject({
      ownerOrgId: org.id,
      unlinkedOrgIds: [org.id],
    });

    // Half one: the stamp is really null (not undefined-skipped by the
    // writeRecord upsert), and the doc + status survived.
    const row = await rowFor("restaurants", "rel-cafe");
    expect(row?.ownerOrgId).toBeNull();
    expect(row?.status).toBe("live");
    expect(row?.doc.name).toBe("Release Cafe");
    expect(row?.updatedBy).toBe(ACTOR);

    // Half two: the grant is gone — and ONLY that grant. can() reads
    // linked_ids, so leaving it would keep the business editing a listing the
    // console now calls unclaimed.
    const after = await getOrg(org.id);
    expect(after?.linkedIds).toEqual(["keep-me"]);

    // Both halves audited.
    const recordTrail = await tdb.db
      .select()
      .from(audit)
      .where(and(eq(audit.store, "restaurants"), eq(audit.recordId, "rel-cafe")));
    expect(recordTrail.some((a) => a.actor === ACTOR && a.source === "admin")).toBe(true);
    const orgTrail = await tdb.db
      .select()
      .from(audit)
      .where(and(eq(audit.store, "orgs"), eq(audit.recordId, org.id)));
    expect(orgTrail.some((a) => a.action === "org-update" && a.actor === ACTOR)).toBe(true);
  });

  it("a released listing can be minted again — the round trip the refusal copy promises", async () => {
    await writeRecord("restaurants", restaurant("rt-cafe", "Round Trip Cafe"), {
      status: "live",
    });
    const invite = await mintInvite(
      { role: "member-business", linkedIds: ["rt-cafe"], newOrgName: "First Owner" },
      ACTOR,
    );
    await redeemInvite(invite.code, {
      email: "first@x.test",
      name: "First",
      password: "password12",
    });

    // Before the release: minting a second claim is refused, and the message
    // now names an action that EXISTS.
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["rt-cafe"], newOrgName: "Second Owner" },
        ACTOR,
      ),
    ).rejects.toThrow(/release the claim on the claims console/i);
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["rt-cafe"], newOrgName: "Second Owner" },
        ACTOR,
      ),
    ).rejects.toThrow(OwnershipConflictError);

    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "restaurants", id: "rt-cafe" }),
    );
    expect(res.status).toBe(200);

    // After it: the same mint succeeds. This is the whole point — a
    // mis-minted claim no longer bricks the listing.
    const second = await mintInvite(
      { role: "member-business", linkedIds: ["rt-cafe"], newOrgName: "Second Owner" },
      ACTOR,
    );
    expect(second.linkedIds).toEqual(["rt-cafe"]);
  });

  it("releasing a claimed DRAFT keeps it a draft (the writeRecord upsert trap)", async () => {
    await writeRecord("directory", directory("rel-draft", "Draft Shop"), {
      status: "draft",
      source: "import",
    });
    const org = await createOrg(
      { name: "Draft Holder", kind: "business", linkedIds: ["rel-draft"] },
      ACTOR,
    );
    await writeRecord("directory", directory("rel-draft", "Draft Shop"), {
      status: "draft",
      source: "import",
      ownerOrgId: org.id,
    });

    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "directory", id: "rel-draft" }),
    );
    expect(res.status).toBe(200);

    const row = await rowFor("directory", "rel-draft");
    expect(row?.ownerOrgId).toBeNull();
    expect(row?.status).toBe("draft"); // NOT silently published
  });

  it("404s an unclaimed listing and changes nothing", async () => {
    await writeRecord("restaurants", restaurant("rel-free", "Free Cafe"), {
      status: "live",
    });
    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "restaurants", id: "rel-free" }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/nothing to release/i);
    expect((await rowFor("restaurants", "rel-free"))?.updatedBy).not.toBe(ACTOR);
  });

  it("rejects an unknown store and an unknown listing without touching anything", async () => {
    expect(
      (await releasePOST(jsonReq("/api/admin/claims/release", { store: "events", id: "x" })))
        .status,
    ).toBe(400);
    expect(
      (
        await releasePOST(
          jsonReq("/api/admin/claims/release", { store: "restaurants", id: "no-such" }),
        )
      ).status,
    ).toBe(404);
  });

  it("repairs a grant-without-owner listing — there is no stamp to clear, and it still works", async () => {
    // The state a failed backfill leaves: the org can edit it, the record
    // records nothing. Release is the reset the console points the admin at.
    await writeRecord("restaurants", restaurant("rel-grant", "Grant Only Cafe"), {
      status: "live",
    });
    const org = await createOrg(
      { name: "Grant Only Org", kind: "business", linkedIds: ["rel-grant"] },
      ACTOR,
    );

    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "restaurants", id: "rel-grant" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.released.ownerOrgId).toBeNull();
    expect(json.row).toMatchObject({ claimed: false, mismatch: null });
    expect((await getOrg(org.id))?.linkedIds).toEqual([]);
  });

  it("releases a grant over a SEED-only listing, which has no row to rewrite", async () => {
    const seedId = restaurantSeed[1].id;
    const org = await createOrg(
      { name: "Seed Only Org", kind: "business", linkedIds: [seedId] },
      ACTOR,
    );
    expect(await rowFor("restaurants", seedId)).toBeUndefined();

    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "restaurants", id: seedId }),
    );
    expect(res.status).toBe(200);
    expect((await getOrg(org.id))?.linkedIds).toEqual([]);
    // No overlay row was invented just to say "unowned".
    expect(await rowFor("restaurants", seedId)).toBeUndefined();
  });

  it("strips the grant even when the two halves name DIFFERENT orgs", async () => {
    await writeRecord("restaurants", restaurant("rel-split", "Split Cafe"), {
      status: "live",
    });
    const granted = await createOrg(
      { name: "Grant Holder", kind: "business", linkedIds: ["rel-split"] },
      ACTOR,
    );
    const stamped = await createOrg(
      { name: "Stamp Holder", kind: "business", linkedIds: [] },
      ACTOR,
    );
    await writeRecord("restaurants", restaurant("rel-split", "Split Cafe"), {
      status: "live",
      ownerOrgId: stamped.id,
    });

    const res = await releasePOST(
      jsonReq("/api/admin/claims/release", { store: "restaurants", id: "rel-split" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).row).toMatchObject({ claimed: false, mismatch: null });
    // Releasing only the STAMPED org would have left Grant Holder editing it.
    expect((await getOrg(granted.id))?.linkedIds).toEqual([]);
    expect((await rowFor("restaurants", "rel-split"))?.ownerOrgId).toBeNull();
  });
});

describe("join-existing-org invite lands BOTH halves", () => {
  let joinOrgId = "";

  it("sets owner_org_id AND extends the existing org's linked_ids", async () => {
    await writeRecord("restaurants", restaurant("join-cafe", "Join Cafe"), {
      status: "live",
    });
    const existing = await createOrg(
      { name: "Existing Group", kind: "business", linkedIds: ["other-listing"] },
      ACTOR,
    );
    joinOrgId = existing.id;

    // The redeemInviteTx buildOrg branch returns null for this shape — no org
    // is created, so nothing inside the transaction touches linked_ids.
    const invite = await createInvite(
      { role: "member-business", linkedIds: ["join-cafe"], orgId: existing.id },
      ACTOR,
    );
    const { user, org } = await redeemInvite(invite.code, {
      email: "join@x.test",
      name: "Joiner",
      password: "password12",
    });
    expect(org).toBeNull(); // joined, not created
    expect(user.orgId).toBe(existing.id);

    // The stamp.
    expect((await rowFor("restaurants", "join-cafe"))?.ownerOrgId).toBe(existing.id);
    // The GRANT — this is what can(user, "edit-record", id) reads. Without it
    // the invited user gets a 403 on the listing they were just invited to.
    const after = await getOrg(existing.id);
    expect(after?.linkedIds).toEqual(["other-listing", "join-cafe"]);
    // Console agrees: one org, both halves, no warning.
    expect(await consoleRow("restaurants", "join-cafe")).toMatchObject({
      claimed: true,
      ownerOrgId: existing.id,
      mismatch: null,
    });
  });

  it("is idempotent — a second invite into the same org does not duplicate the id", async () => {
    const invite = await createInvite(
      { role: "member-business", linkedIds: ["join-cafe"], orgId: joinOrgId },
      ACTOR,
    );
    await redeemInvite(invite.code, {
      email: "join2@x.test",
      name: "Joiner Two",
      password: "password12",
    });
    const after = await getOrg(joinOrgId);
    expect(after?.linkedIds.filter((id) => id === "join-cafe")).toHaveLength(1);
  });
});

describe("claimed = the UNION of stamp and grant", () => {
  it("mint refuses over a grant whose stamp never landed", async () => {
    await writeRecord("restaurants", restaurant("half-cafe", "Half Cafe"), {
      status: "live",
    });
    // Exactly the state a failed backfill leaves behind: the org can edit it,
    // the record says nothing.
    await createOrg(
      { name: "Half Claimant", kind: "business", linkedIds: ["half-cafe"] },
      ACTOR,
    );
    expect((await rowFor("restaurants", "half-cafe"))?.ownerOrgId).toBeFalsy();

    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["half-cafe"], newOrgName: "Second Org" },
        ACTOR,
      ),
    ).rejects.toThrow(/half-cafe is already claimed by Half Claimant/);
  });

  it("the console shows the disagreement instead of a confident 'Unclaimed'", async () => {
    expect(await consoleRow("restaurants", "half-cafe")).toMatchObject({
      claimed: true,
      ownerOrgId: null,
      mismatch: "grant-without-owner",
    });
  });

  it("a stamp with no grant is flagged too — the owner would get a 403", async () => {
    await writeRecord("restaurants", restaurant("stamp-only", "Stamp Only"), {
      status: "live",
    });
    const org = await createOrg(
      { name: "Stamp Only Org", kind: "business", linkedIds: [] },
      ACTOR,
    );
    await writeRecord("restaurants", restaurant("stamp-only", "Stamp Only"), {
      status: "live",
      ownerOrgId: org.id,
    });
    expect(await consoleRow("restaurants", "stamp-only")).toMatchObject({
      claimed: true,
      mismatch: "owner-without-grant",
    });
  });

  it("a grant over a SEED-only listing still reads as claimed", async () => {
    const seedId = restaurantSeed[2].id;
    await createOrg(
      { name: "Seed Grant Org", kind: "business", linkedIds: [seedId] },
      ACTOR,
    );
    expect(await consoleRow("restaurants", seedId)).toMatchObject({
      claimed: true,
      source: "seed",
      mismatch: "grant-without-owner",
    });
  });

  it("joining the org that already holds the listing is NOT a conflict", async () => {
    // The refusal message recommends exactly this; refusing it would make the
    // message a second lie.
    await writeRecord("restaurants", restaurant("same-org", "Same Org Cafe"), {
      status: "live",
    });
    const org = await createOrg(
      { name: "Already Holds It", kind: "business", linkedIds: ["same-org"] },
      ACTOR,
    );
    await writeRecord("restaurants", restaurant("same-org", "Same Org Cafe"), {
      status: "live",
      ownerOrgId: org.id,
    });

    const invite = await mintInvite(
      { role: "member-business", linkedIds: ["same-org"], orgId: org.id },
      ACTOR,
    );
    expect(invite.orgId).toBe(org.id);
    // …and it redeems, rather than 409-ing on its own org's claim.
    const { user } = await redeemInvite(invite.code, {
      email: "second-hand@x.test",
      name: "Second Hand",
      password: "password12",
    });
    expect(user.orgId).toBe(org.id);
  });
});

describe("backfillLinkedOwnership reports what it did", () => {
  it("stamps an id present in TWO of a kind's stores in BOTH of them", async () => {
    // The bare-id bookkeeping stamped whichever store was read first and
    // silently skipped the other.
    await writeRecord("restaurants", restaurant("dual-id", "Dual Cafe"), {
      status: "live",
    });
    await writeRecord("directory", directory("dual-id", "Dual Shop"), {
      status: "draft",
      source: "import",
    });
    const org = await createOrg({ name: "Dual Org", kind: "business" }, ACTOR);

    const result = await backfillLinkedOwnership("business", ["dual-id"], org.id, ACTOR);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.stamped.map((s) => s.store).sort()).toEqual(["directory", "restaurants"]);
    expect((await rowFor("restaurants", "dual-id"))?.ownerOrgId).toBe(org.id);
    expect((await rowFor("directory", "dual-id"))?.ownerOrgId).toBe(org.id);
    // Each store kept its own status.
    expect((await rowFor("directory", "dual-id"))?.status).toBe("draft");
  });

  it("returns a structured result — skips are named, not swallowed by a bare `continue`", async () => {
    await writeRecord("restaurants", restaurant("bf-owned", "Owned Cafe"), {
      status: "live",
    });
    const other = await createOrg({ name: "Other Org", kind: "business" }, ACTOR);
    await writeRecord("restaurants", restaurant("bf-owned", "Owned Cafe"), {
      status: "live",
      ownerOrgId: other.id,
    });
    await writeRecord("restaurants", { id: "bf-gone", _deleted: true } as {
      id: string;
      _deleted: true;
    });
    const org = await createOrg({ name: "Backfill Org", kind: "business" }, ACTOR);

    const result = await backfillLinkedOwnership(
      "business",
      ["bf-owned", "bf-gone", "bf-nowhere"],
      org.id,
      ACTOR,
    );
    expect(result.ok).toBe(true);
    // ok (nothing threw) but NOT complete — the alertable signal.
    expect(result.complete).toBe(false);
    expect(result.stamped).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "bf-owned", reason: "already-owned", ownerOrgId: other.id }),
        expect.objectContaining({ id: "bf-gone", reason: "tombstoned" }),
        expect.objectContaining({ id: "bf-nowhere", reason: "no-such-record" }),
      ]),
    );
    // …and it did not steal the record another org owns.
    expect((await rowFor("restaurants", "bf-owned"))?.ownerOrgId).toBe(other.id);
  });

  it("one bad record does not abort the rest — the failure is reported per id", async () => {
    // A doc the store schema rejects: writeRecord throws inside the loop.
    await tdb.db.execute(
      sql`insert into record (store, id, doc, status, source, updated_by)
          values ('restaurants', 'bf-broken', '{"id":"bf-broken"}'::jsonb, 'live', 'admin', 'test')`,
    );
    await writeRecord("restaurants", restaurant("bf-good", "Good Cafe"), { status: "live" });
    const org = await createOrg({ name: "Partial Org", kind: "business" }, ACTOR);

    const result = await backfillLinkedOwnership(
      "business",
      ["bf-broken", "bf-good"],
      org.id,
      ACTOR,
    );
    expect(result.ok).toBe(false);
    expect(result.failed.map((f) => f.id)).toEqual(["bf-broken"]);
    expect(result.failed[0].error).toBeTruthy();
    // The good one still landed.
    expect(result.stamped.map((s) => s.id)).toEqual(["bf-good"]);
    expect((await rowFor("restaurants", "bf-good"))?.ownerOrgId).toBe(org.id);
  });
});
