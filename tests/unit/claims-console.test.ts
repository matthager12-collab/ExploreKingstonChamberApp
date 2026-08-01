// E17 claims console — server assembly + role derivation (charter step 6).
//
// getClaimsConsoleRows() is the privileged read behind /admin/claims: seeds
// merge with any-status overlay rows across all four claimable domains, and
// owner_org_id joins to the org's name through the identity layer. The role
// map is pinned exactly — the console derives the invite role from the
// store, so a drifted mapping silently mints the wrong kind of account.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrg } from "@/lib/auth/identity";
import {
  CLAIM_INVITE_ROLE_BY_STORE,
  getClaimsConsoleRows,
  type ClaimsConsoleRow,
} from "@/lib/claims/console-data";
import { charities as charitySeed } from "@/lib/data/charities";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { writeRecord } from "@/lib/db/records";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

function row(
  rows: ClaimsConsoleRow[],
  store: string,
  id: string,
): ClaimsConsoleRow | undefined {
  return rows.find((r) => r.store === store && r.id === id);
}

describe("role derivation", () => {
  it("maps exactly: charities → org-editor; restaurants, lodging, directory → member-business", () => {
    expect(CLAIM_INVITE_ROLE_BY_STORE).toEqual({
      restaurants: "member-business",
      lodging: "member-business",
      charities: "org-editor",
      directory: "member-business",
    });
  });
});

describe("getClaimsConsoleRows", () => {
  it("seed-only records read as unclaimed live rows with source 'seed' in every seeded domain", async () => {
    const rows = await getClaimsConsoleRows();
    for (const [store, seed] of [
      ["restaurants", restaurantSeed[0]],
      ["lodging", lodgingSeed[0]],
      ["charities", charitySeed[0]],
    ] as const) {
      const r = row(rows, store, seed.id);
      expect(r, `${store}/${seed.id} missing`).toBeDefined();
      expect(r).toMatchObject({
        name: seed.name,
        status: "live",
        source: "seed",
        claimed: false,
        ownerOrgId: null,
        ownerOrgName: null,
      });
    }
  });

  it("an owned overlay row reads as claimed, with the owning org's name joined", async () => {
    const org = await createOrg(
      { name: "Sourdough Willy's LLC", kind: "business" },
      "test@example.test",
    );
    await writeRecord(
      "restaurants",
      { ...restaurantSeed[1], id: "owned-cafe", name: "Owned Cafe" },
      { status: "live", source: "admin", ownerOrgId: org.id },
    );

    const r = row(await getClaimsConsoleRows(), "restaurants", "owned-cafe");
    expect(r).toMatchObject({
      name: "Owned Cafe",
      claimed: true,
      ownerOrgId: org.id,
      ownerOrgName: "Sourdough Willy's LLC",
    });
  });

  it("an owned overlay of a SEED charity flips that row to claimed (overlay wins by id)", async () => {
    const org = await createOrg(
      { name: "Kingston Cares", kind: "nonprofit" },
      "test@example.test",
    );
    await writeRecord(
      "charities",
      { ...charitySeed[0] },
      { status: "live", source: "admin", ownerOrgId: org.id },
    );

    const r = row(await getClaimsConsoleRows(), "charities", charitySeed[0].id);
    expect(r).toMatchObject({
      claimed: true,
      ownerOrgName: "Kingston Cares",
      source: "admin",
    });
  });

  it("a draft directory import participates (drafts are that store's normal state), unclaimed", async () => {
    await writeRecord(
      "directory",
      {
        id: "dir-import-1",
        name: "Imported Shop",
        category: "shop",
        description: "An imported directory listing",
        tags: [],
      },
      { status: "draft", source: "import" },
    );

    const r = row(await getClaimsConsoleRows(), "directory", "dir-import-1");
    expect(r).toMatchObject({
      name: "Imported Shop",
      status: "draft",
      source: "import",
      claimed: false,
      ownerOrgName: null,
    });
  });

  it("a tombstoned overlay hides the record — and its seed — from the console", async () => {
    await writeRecord("lodging", { id: lodgingSeed[0].id, _deleted: true } as {
      id: string;
      _deleted: true;
    });

    const rows = await getClaimsConsoleRows();
    expect(row(rows, "lodging", lodgingSeed[0].id)).toBeUndefined();
    // The other lodging seeds still read normally.
    expect(row(rows, "lodging", lodgingSeed[1].id)).toMatchObject({
      claimed: false,
      source: "seed",
    });
  });

  it("covers all four domains in one assembled result", async () => {
    const stores = new Set((await getClaimsConsoleRows()).map((r) => r.store));
    expect(stores).toEqual(new Set(["restaurants", "lodging", "charities", "directory"]));
  });
});
