// E17 claim-signup slice, end to end at the DOMAIN layer, over PGlite:
// start (code emailed, nothing created) → verify (account + org in one
// transaction; roster match lands the claim, no match queues it) → the
// Chamber's approve path for the queued case. The HTTP routes above these
// functions are thin maps from typed errors to statuses; the rules all live
// here, so this is where they are pinned.
//
// The email seam is mocked to CAPTURE the code — the domain sends before it
// inserts, so the captured code is the one the row will verify against.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import { claimContact, claimSignup, invites, orgs, users } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

vi.mock("@/lib/email", () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
      sent.push(input);
      return { sent: true, id: "test-email" };
    }),
    __sent: sent,
  };
});

import { sendEmail } from "@/lib/email";
import {
  approvePendingClaimSignup,
  claimAsSignedIn,
  getClaimableBusiness,
  listClaimableDirectory,
  MAX_CODE_ATTEMPTS,
  startClaimSignup,
  verifyClaimSignup,
} from "@/lib/claims/self-signup";
import { AuthError, listOrganizations, verifyCredentials } from "@/lib/auth/identity";
import { upsertClaimContacts } from "@/lib/db/claim-store";
import { findOwnedLinkedRecords, OwnershipConflictError } from "@/lib/ownership";
import { saveDirectoryListing } from "@/lib/stores/directory-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import type { DirectoryListing } from "@/lib/types";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
afterEach(async () => {
  vi.mocked(sendEmail).mockClear();
  await tdb.db.delete(users);
  await tdb.db.delete(invites);
  await tdb.db.delete(orgs);
  await tdb.db.delete(claimSignup);
  await tdb.db.delete(claimContact);
  await tdb.db.execute(sql`DELETE FROM worklist_item`);
  await tdb.db.execute(sql`DELETE FROM record`);
  await tdb.db.execute(sql`TRUNCATE audit`);
});

const LISTING: DirectoryListing = {
  id: "gz-bait-shop",
  name: "Kingston Bait & Tackle",
  category: "shop",
  description: "Imported draft — bait, tackle, and tall tales.",
  tags: [],
};

async function seedDraft(listing: DirectoryListing = LISTING): Promise<void> {
  await saveDirectoryListing(listing, {
    actor: "import:growthzone",
    source: "import",
    status: "draft",
  });
}

async function seedRosterEmail(email: string, id = LISTING.id): Promise<void> {
  await upsertClaimContacts([
    { subjectStore: "directory", subjectId: id, email, source: "test", createdBy: "test" },
  ]);
}

/** The 6-digit code from the LAST captured email. */
function lastEmailedCode(): string {
  const calls = vi.mocked(sendEmail).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const match = /\b(\d{6})\b/.exec(calls[calls.length - 1][0].text);
  expect(match).not.toBeNull();
  return match![1];
}

const START = {
  store: "directory",
  id: LISTING.id,
  name: "Pat Owner",
  email: "owner@baitshop.test",
  password: "long-enough-pw",
};

describe("startClaimSignup", () => {
  it("emails a code and creates NOTHING but the pending row", async () => {
    await seedDraft();
    const result = await startClaimSignup(START);
    expect(result.emailSent).toBe(true);
    expect(result.signupId).toMatch(/^[0-9a-f]{16}$/);
    expect(await tdb.db.select().from(users)).toHaveLength(0);
    expect(await tdb.db.select().from(orgs)).toHaveLength(0);
    expect(await listWorklistItems({ type: "claim_signup" })).toHaveLength(0);
  });

  it("answers identically whether or not the email is on the roster (no oracle)", async () => {
    await seedDraft();
    await seedRosterEmail(START.email);
    const onRoster = await startClaimSignup(START);
    const offRoster = await startClaimSignup({
      ...START,
      email: "stranger@example.test",
    });
    expect(Object.keys(onRoster).sort()).toEqual(Object.keys(offRoster).sort());
    expect(onRoster.emailSent).toBe(offRoster.emailSent);
  });

  it("refuses an unknown listing, a short password, and a claimed listing", async () => {
    await seedDraft();
    await expect(startClaimSignup({ ...START, id: "no-such" })).rejects.toThrow(
      /not found/i,
    );
    await expect(startClaimSignup({ ...START, password: "short" })).rejects.toThrow(
      AuthError,
    );
    // Claim it, then a second start must 409.
    await seedRosterEmail(START.email);
    await startClaimSignup(START);
    await verifyClaimSignup({
      signupId: (await startClaimSignup(START)).signupId,
      code: lastEmailedCode(),
    });
    await expect(startClaimSignup({ ...START, email: "other@x.test" })).rejects.toThrow(
      OwnershipConflictError,
    );
  });
});

describe("verifyClaimSignup — roster match", () => {
  it("creates account + org, lands BOTH claim halves, resolves a worklist crumb", async () => {
    await seedDraft();
    await seedRosterEmail("Owner@BaitShop.test"); // case-insensitive on purpose
    const { signupId } = await startClaimSignup(START);
    const result = await verifyClaimSignup({ signupId, code: lastEmailedCode() });

    expect(result.approved).toBe(true);
    expect(result.user.role).toBe("member-business");
    // The password set at start signs in.
    expect(await verifyCredentials(START.email, START.password)).not.toBeNull();
    // Grant half: the org carries the listing id.
    const [org] = await listOrganizations();
    expect(org.kind).toBe("business");
    expect(org.linkedIds).toEqual([LISTING.id]);
    // Stamp half: owner_org_id landed.
    const owned = await findOwnedLinkedRecords("business", [LISTING.id]);
    expect(owned).toEqual([
      { id: LISTING.id, store: "directory", ownerOrgId: org.id },
    ]);
    // The audit crumb: a claim_signup item, already resolved "approved".
    const items = await listWorklistItems({ type: "claim_signup" });
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe("resolved");
    expect(items[0].resolution).toBe("approved");
    // The public projection now shows it claimed.
    expect((await getClaimableBusiness(LISTING.id))?.claimed).toBe(true);
  });

  it("burns the code: a second verify with the same pair refuses uniformly", async () => {
    await seedDraft();
    await seedRosterEmail(START.email);
    const { signupId } = await startClaimSignup(START);
    const code = lastEmailedCode();
    await verifyClaimSignup({ signupId, code });
    await expect(verifyClaimSignup({ signupId, code })).rejects.toThrow(
      /invalid or has expired/i,
    );
  });
});

describe("verifyClaimSignup — no roster match", () => {
  it("creates the account rights-free and opens a worklist item; approval lands the claim", async () => {
    await seedDraft();
    const { signupId } = await startClaimSignup(START);
    const result = await verifyClaimSignup({ signupId, code: lastEmailedCode() });

    expect(result.approved).toBe(false);
    const [org] = await listOrganizations();
    expect(org.linkedIds).toEqual([]);
    expect(await findOwnedLinkedRecords("business", [LISTING.id])).toEqual([]);
    const [item] = await listWorklistItems({ type: "claim_signup" });
    expect(item.state).toBe("open");
    expect(item.payload.userId).toBe(result.user.id);
    expect(item.payload.orgId).toBe(org.id);
    expect(item.payload.verifiedBy).toBe("code");

    // The Chamber says yes: both halves land through the same helpers.
    await approvePendingClaimSignup({
      store: "directory",
      id: LISTING.id,
      orgId: org.id,
      actor: "admin@example.test",
    });
    const [after] = await listOrganizations();
    expect(after.linkedIds).toEqual([LISTING.id]);
    const owned = await findOwnedLinkedRecords("business", [LISTING.id]);
    expect(owned[0]?.ownerOrgId).toBe(org.id);
  });

  it("approve refuses when the listing was claimed by someone else meanwhile", async () => {
    await seedDraft();
    const { signupId } = await startClaimSignup(START);
    await verifyClaimSignup({ signupId, code: lastEmailedCode() });
    const [pendingOrg] = await listOrganizations();

    // A rival with the roster email claims it first.
    await seedRosterEmail("rival@baitshop.test");
    const rival = await startClaimSignup({
      ...START,
      name: "Riva L",
      email: "rival@baitshop.test",
    });
    await verifyClaimSignup({ signupId: rival.signupId, code: lastEmailedCode() });

    await expect(
      approvePendingClaimSignup({
        store: "directory",
        id: LISTING.id,
        orgId: pendingOrg.id,
        actor: "admin@example.test",
      }),
    ).rejects.toThrow(OwnershipConflictError);
  });
});

describe("verifyClaimSignup — guess resistance", () => {
  it(`kills the row after ${MAX_CODE_ATTEMPTS} wrong guesses — the right code no longer works`, async () => {
    await seedDraft();
    await seedRosterEmail(START.email);
    const { signupId } = await startClaimSignup(START);
    const code = lastEmailedCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
      await expect(verifyClaimSignup({ signupId, code: wrong })).rejects.toThrow(
        /invalid or has expired/i,
      );
    }
    await expect(verifyClaimSignup({ signupId, code })).rejects.toThrow(
      /invalid or has expired/i,
    );
    expect(await tdb.db.select().from(users)).toHaveLength(0);
  });

  it("refuses an email that already has an account, AFTER the code proves the mailbox", async () => {
    await seedDraft();
    await seedRosterEmail(START.email);
    const first = await startClaimSignup(START);
    await verifyClaimSignup({ signupId: first.signupId, code: lastEmailedCode() });

    // Same email, fresh listing.
    await seedDraft({ ...LISTING, id: "gz-second", name: "Second Shop" });
    const second = await startClaimSignup({ ...START, id: "gz-second" });
    await expect(
      verifyClaimSignup({ signupId: second.signupId, code: lastEmailedCode() }),
    ).rejects.toThrow(/already have an account/i);
  });
});

describe("claimAsSignedIn", () => {
  it("auto-approves on a roster match against the session email, else queues", async () => {
    await seedDraft();
    await seedRosterEmail(START.email);
    const { signupId } = await startClaimSignup(START);
    const { user } = await verifyClaimSignup({ signupId, code: lastEmailedCode() });

    // A second listing, roster email matches the account.
    await seedDraft({ ...LISTING, id: "gz-two", name: "Bait Two" });
    await seedRosterEmail(START.email, "gz-two");
    const matched = await claimAsSignedIn(user, { store: "directory", id: "gz-two" });
    expect(matched.approved).toBe(true);

    // A third, no roster row → queued for the Chamber.
    await seedDraft({ ...LISTING, id: "gz-three", name: "Bait Three" });
    const queued = await claimAsSignedIn(user, { store: "directory", id: "gz-three" });
    expect(queued.approved).toBe(false);
    const open = (await listWorklistItems({ type: "claim_signup" })).filter(
      (i) => i.state === "open",
    );
    expect(open).toHaveLength(1);
    expect(open[0].subjectId).toBe("gz-three");
    expect(open[0].payload.verifiedBy).toBe("session");

    // Already-managed listings refuse.
    await expect(
      claimAsSignedIn(user, { store: "directory", id: "gz-two" }),
    ).rejects.toThrow(/already manage/i);
  });
});

describe("the /claim projection", () => {
  it("lists drafts by name/category/claimed only, alphabetically", async () => {
    await seedDraft({ ...LISTING, id: "gz-zeta", name: "Zeta Services", category: "services" });
    await seedDraft();
    const rows = await listClaimableDirectory();
    expect(rows.map((r) => r.name)).toEqual(["Kingston Bait & Tackle", "Zeta Services"]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["category", "claimed", "id", "name"]);
    }
  });
});
