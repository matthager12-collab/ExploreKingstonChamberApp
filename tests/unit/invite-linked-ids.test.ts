// Invite minting — linkedIds validation (portal-lodging).
//
// POST /api/portal/invites validates linkedIds against the store the derived
// org kind points into. For kind:"business" that is the UNION of the two
// member-editable listing stores — restaurants AND lodging — so the /stay
// businesses can be onboarded exactly like restaurants. Unknown ids are still
// rejected outright, and the nonprofit path still validates against charities
// only (no cross-kind leakage in either direction).
//
// requireRole/getSessionUser are stubbed to an admin (route-gate behavior is
// covered by tests/unit/authz-gate-coverage.test.ts and the admin walk);
// everything else — createInvite, its org-binding rules, the invites table —
// is the real thing against the migrated PGlite database.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { charities as charitySeed } from "@/lib/data/charities";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
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

function mintReq(body: unknown) {
  return new NextRequest("http://localhost/api/portal/invites", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("member-business linkedIds validate against restaurants ∪ lodging", () => {
  it("mints an invite linking a lodging listing", async () => {
    const res = await invitesPOST(
      mintReq({
        role: "member-business",
        linkedIds: [lodgingSeed[0].id],
        newOrgName: "The Point Casino & Hotel",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.invite.linkedIds).toEqual([lodgingSeed[0].id]);
    expect(json.invite.newOrgKind).toBe("business");
  });

  it("mints an invite mixing a restaurant and a lodging listing", async () => {
    const res = await invitesPOST(
      mintReq({
        role: "member-business",
        linkedIds: [restaurantSeed[0].id, lodgingSeed[1].id],
        newOrgName: "Two-Listing Holdings",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.invite.linkedIds).toEqual(
      expect.arrayContaining([restaurantSeed[0].id, lodgingSeed[1].id]),
    );
  });

  it("still rejects an unknown id, naming it", async () => {
    const res = await invitesPOST(
      mintReq({
        role: "member-business",
        linkedIds: [lodgingSeed[0].id, "no-such-listing"],
        newOrgName: "Ghost Inn",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("unknown business id(s): no-such-listing");
  });

  it("rejects a charity id — the union spans the listing stores only", async () => {
    const res = await invitesPOST(
      mintReq({
        role: "member-business",
        linkedIds: [charitySeed[0].id],
        newOrgName: "Mismatched Kind",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("unknown business id(s)");
  });
});

describe("org-editor linkedIds still validate against charities only", () => {
  it("rejects a lodging id for a nonprofit invite", async () => {
    const res = await invitesPOST(
      mintReq({
        role: "org-editor",
        linkedIds: [lodgingSeed[0].id],
        newOrgName: "Not A Nonprofit",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("unknown charity id(s)");
  });

  it("still mints with a charity id (unchanged path)", async () => {
    const res = await invitesPOST(
      mintReq({
        role: "org-editor",
        linkedIds: [charitySeed[0].id],
        newOrgName: "Nonprofit Y",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).invite.linkedIds).toEqual([charitySeed[0].id]);
  });
});
