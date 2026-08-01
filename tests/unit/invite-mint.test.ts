// mintInvite — the shared invite-request validation + minting path, over
// PGlite (real Postgres engine, checked-in migrations).
//
// This is the function BOTH writers ride: POST /api/portal/invites and the
// batch onboarding script (scripts/mint-invites.ts). What it pins:
//
//  - the route's inline checks moved here VERBATIM — same rejection messages,
//    so the refactor cannot have changed a single API response byte;
//  - linked-id validation runs against the REAL stores (seed + live overlay),
//    with lodging ids invalid by default (the API's behavior today) and valid
//    only under the batch script's explicit includeLodging opt-in;
//  - the org kind is derived from the role, never taken from the caller;
//  - createInvite's own rules (admin-requires-email, org join-XOR-create)
//    surface through the same AuthError channel.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthError, INVITE_TTL_DAYS, inviteState } from "@/lib/auth/identity";
import { writeRecord } from "@/lib/db/records";
import { mintInvite } from "@/lib/invite-mint";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();

  // One LIVE overlay record per business store, plus a pending restaurant that
  // must NOT count as a valid target (readMerged filters to live).
  await writeRecord(
    "restaurants",
    {
      id: "mint-cafe",
      name: "Mint Cafe",
      cuisine: "Cafe",
      description: "Live restaurant listing.",
      address: "1 Main St",
      priceLevel: 1,
      tags: [],
      lat: 47.797,
      lng: -122.497,
      walkMinutesFromFerry: 2,
    },
    { status: "live" },
  );
  await writeRecord(
    "restaurants",
    {
      id: "mint-pending-cafe",
      name: "Pending Cafe",
      cuisine: "Cafe",
      description: "Submitted, NOT approved.",
      address: "2 Main St",
      priceLevel: 1,
      tags: [],
      lat: 47.798,
      lng: -122.498,
      walkMinutesFromFerry: 3,
    },
    { status: "pending" },
  );
  await writeRecord(
    "lodging",
    {
      id: "mint-inn",
      name: "Mint Inn",
      type: "hotel",
      description: "Live lodging listing.",
      tags: [],
    },
    { status: "live" },
  );
});
afterAll(async () => {
  await tdb.close();
});

const ACTOR = "admin@example.test";

describe("mintInvite — member-business (the batch-onboarding shape)", () => {
  it("mints a listing-linked invite that creates the business org on redemption", async () => {
    const invite = await mintInvite(
      {
        role: "member-business",
        linkedIds: ["mint-cafe"],
        newOrgName: "Mint Cafe",
        note: "Launch onboarding — Mint Cafe",
      },
      ACTOR,
    );
    expect(invite.code).toBeTruthy();
    expect(invite.role).toBe("member-business");
    expect(invite.linkedIds).toEqual(["mint-cafe"]);
    expect(invite.newOrgName).toBe("Mint Cafe");
    expect(invite.newOrgKind).toBe("business");
    expect(invite.createdBy).toBe(ACTOR);
    expect(inviteState(invite)).toBe("active");
    // 14-day expiry, computed by createInvite — not re-implemented anywhere.
    const days = (invite.expiresAt.getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(INVITE_TTL_DAYS - 1);
    expect(days).toBeLessThanOrEqual(INVITE_TTL_DAYS);
  });

  it("rejects an unknown business id with the route's exact message", async () => {
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["nope"], newOrgName: "X" },
        ACTOR,
      ),
    ).rejects.toThrow(/unknown restaurant id\(s\): nope/);
  });

  it("does not treat a pending (unapproved) listing as a valid target", async () => {
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["mint-pending-cafe"], newOrgName: "X" },
        ACTOR,
      ),
    ).rejects.toThrow(/unknown restaurant id\(s\): mint-pending-cafe/);
  });

  it("rejects a lodging id by default — the API's universe is restaurants only", async () => {
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["mint-inn"], newOrgName: "Mint Inn" },
        ACTOR,
      ),
    ).rejects.toThrow(/unknown restaurant id\(s\): mint-inn/);
  });

  it("accepts a lodging id under includeLodging (the batch script's universe)", async () => {
    const invite = await mintInvite(
      { role: "member-business", linkedIds: ["mint-inn"], newOrgName: "Mint Inn" },
      ACTOR,
      { includeLodging: true },
    );
    expect(invite.linkedIds).toEqual(["mint-inn"]);
    expect(invite.newOrgKind).toBe("business");
  });

  it("names the wider universe in the unknown-id message under includeLodging", async () => {
    await expect(
      mintInvite(
        { role: "member-business", linkedIds: ["nope"], newOrgName: "X" },
        ACTOR,
        { includeLodging: true },
      ),
    ).rejects.toThrow(/unknown business listing id\(s\): nope/);
  });

  it("dedupes linkedIds and drops non-string entries", async () => {
    const invite = await mintInvite(
      {
        role: "member-business",
        linkedIds: ["mint-cafe", "mint-cafe", 42, null],
        newOrgName: "Mint Cafe",
      },
      ACTOR,
    );
    expect(invite.linkedIds).toEqual(["mint-cafe"]);
  });
});

describe("mintInvite — validation moved verbatim from the route", () => {
  it("rejects an unknown role with the roles list", async () => {
    await expect(mintInvite({ role: "superuser" }, ACTOR)).rejects.toThrow(
      /role must be one of: /,
    );
  });

  it("validates org-editor linked ids against CHARITIES, and derives kind nonprofit", async () => {
    // The kind is derived from the role — a business id is invalid here even
    // though it exists, because org-editor ids point into the charity store.
    await expect(
      mintInvite(
        { role: "org-editor", linkedIds: ["mint-cafe"], newOrgName: "Helpers" },
        ACTOR,
      ),
    ).rejects.toThrow(/unknown charity id\(s\): mint-cafe/);

    const invite = await mintInvite(
      { role: "org-editor", linkedIds: [], newOrgName: "Helpers" },
      ACTOR,
    );
    expect(invite.newOrgKind).toBe("nonprofit");
  });

  it("ignores linkedIds for staff roles (they edit everything or nothing)", async () => {
    const invite = await mintInvite(
      { role: "moderator", linkedIds: ["mint-cafe"] },
      ACTOR,
    );
    expect(invite.linkedIds).toEqual([]);
    expect(invite.newOrgKind).toBeNull();
  });

  it("trims the note and truncates it to 200 characters; blank becomes null", async () => {
    const long = `  ${"x".repeat(300)}  `;
    const invite = await mintInvite(
      { role: "member-business", newOrgName: "Mint Cafe", note: long },
      ACTOR,
    );
    expect(invite.note).toBe("x".repeat(200));

    const blank = await mintInvite(
      { role: "member-business", newOrgName: "Mint Cafe", note: "   " },
      ACTOR,
    );
    expect(blank.note).toBeNull();
  });

  it("surfaces createInvite's own rules through the same AuthError channel", async () => {
    // admin-requires-email
    await expect(mintInvite({ role: "admin" }, ACTOR)).rejects.toThrow(AuthError);
    await expect(mintInvite({ role: "admin" }, ACTOR)).rejects.toThrow(/bound to an email/);
    // org join-XOR-create
    await expect(
      mintInvite(
        { role: "member-business", orgId: "some-org", newOrgName: "Also New" },
        ACTOR,
      ),
    ).rejects.toThrow(/not both/);
    await expect(mintInvite({ role: "member-business" }, ACTOR)).rejects.toThrow(
      /Pick an existing organization or name a new one/,
    );
  });
});
