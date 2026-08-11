// Claim-signup TEST FIXTURE (E17 claim-signup slice): a directory draft the
// Chamber (Mat) can claim over and over to exercise the whole self-serve
// flow — find on /claim, sign up, receive the code, verify, land (or queue)
// the claim — then wind back and go again.
//
//   npm run seed:claim-test                 # (re)create the listing + contacts
//   npm run seed:claim-test -- --reset      # also wind back any test claim:
//                                           #   release grant + ownership stamp,
//                                           #   delete the test account + org,
//                                           #   drop pending signups,
//                                           #   close open worklist items
//   npm run seed:claim-test -- --email a@b  # extra roster email (repeatable)
//
// The roster emails default to Mat's own addresses (his request, 2026-08-11),
// so the verification codes land in his inboxes:
//   matt.hager12@gmail.com · director@kingstonchamber.com
//
// SCOPE GUARD: --reset touches ONLY things that trace back to the test
// listing — orgs that hold its id or carry its exact name, those orgs' NON-
// STAFF member accounts, its signup rows, its worklist items. Admin accounts
// are structurally out of reach (staff carry no org). DATABASE_URL decides
// the target; the same host-confirmation rule as the importer applies.
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server (same as
// import-growthzone) so the data layer's `server-only` guard resolves.

import { createInterface } from "node:readline/promises";

import {
  deleteEmptyOrg,
  deleteUser,
  listOrganizations,
  listUsers,
  removeOrgLinkedIds,
} from "../src/lib/auth/identity";
import {
  deleteClaimSignupsFor,
  listClaimContacts,
  upsertClaimContacts,
} from "../src/lib/db/claim-store";
import { ORG_ROLES } from "../src/lib/db/schema";
import {
  getDirectoryListingsAdmin,
  saveDirectoryListing,
} from "../src/lib/stores/directory-store";
import { listWorklistItems, resolveItem } from "../src/lib/stores/worklist-store";
import type { DirectoryListing } from "../src/lib/types";

const ACTOR = "seed:claim-test";
const STORE = "directory";

/** Stable id + unmistakable name — both say "test" so nobody polishes it. */
const TEST_ID = "test-claim-business";
const TEST_NAME = "Explore Kingston Test Business";

const DEFAULT_EMAILS = ["matt.hager12@gmail.com", "director@kingstonchamber.com"];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const optAll = (name: string) => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1] !== undefined) out.push(args[i + 1]);
  }
  return out;
};

const record: DirectoryListing = {
  id: TEST_ID,
  name: TEST_NAME,
  category: "services",
  description:
    "Chamber test record for the claim-your-business flow. Not a real business — " +
    "staff claim it to rehearse signup, verification, and approval. If you are a " +
    "visitor reading this: nothing to see here.",
  tags: ["test"],
};

async function confirmHost(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.error("HALT: DATABASE_URL must be set.");
    return false;
  }
  let host: string;
  try {
    host = new URL(process.env.DATABASE_URL).host;
  } catch {
    host = "<unparseable DATABASE_URL>";
  }
  if (flag("--yes")) {
    console.log(`Target: ${host} (confirmed via --yes).`);
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`About to write the claim test fixture to ${host}. Type the host to confirm: `);
  rl.close();
  if (answer.trim() !== host) {
    console.error("aborted — host mismatch.");
    return false;
  }
  return true;
}

async function reset(): Promise<void> {
  // 1. Grants: strip the test listing's id from every org holding it, and
  //    remember those orgs — they are test artifacts.
  const orgs = await listOrganizations();
  const testOrgs = orgs.filter(
    (o) => o.linkedIds.includes(TEST_ID) || o.name === TEST_NAME,
  );
  for (const org of testOrgs) {
    if (org.linkedIds.includes(TEST_ID)) {
      await removeOrgLinkedIds(org.id, [TEST_ID], ACTOR);
      console.log(`reset: removed grant from org ${org.id} («${org.name}»)`);
    }
  }

  // 2. Ownership stamp: rewrite the listing with owner cleared (explicit
  //    null CLEARS the column — the documented release path), status draft.
  await saveDirectoryListing(record, {
    actor: ACTOR,
    source: "admin",
    status: "draft",
    ownerOrgId: null,
  });
  console.log("reset: ownership stamp cleared, listing back to draft");

  // 3. Accounts: delete the test orgs' member accounts (org roles only —
  //    staff have no org, so an admin can never match), then the emptied orgs.
  const users = await listUsers();
  for (const org of testOrgs) {
    const members = users.filter(
      (u) => u.orgId === org.id && (ORG_ROLES as readonly string[]).includes(u.role),
    );
    for (const m of members) {
      await deleteUser(m.id, ACTOR);
      console.log(`reset: deleted test account ${m.email}`);
    }
    await deleteEmptyOrg(org.id, ACTOR);
    console.log(`reset: deleted test org ${org.id} («${org.name}»)`);
  }

  // 4. Pending signups for the listing.
  const reaped = await deleteClaimSignupsFor(STORE, [TEST_ID]);
  if (reaped > 0) console.log(`reset: dropped ${reaped} pending signup(s)`);

  // 5. Open worklist items: close them so the queue does not accumulate
  //    rehearsal noise. (Resolved items stay — they are the paper trail.)
  const open = await listWorklistItems({ state: ["open", "in_progress"], subjectStore: STORE });
  for (const item of open) {
    if (item.subjectId !== TEST_ID) continue;
    if (item.type !== "claim_signup" && item.type !== "claim_request") continue;
    await resolveItem(
      item.id,
      {
        resolution: item.type === "claim_signup" ? "declined" : "rejected",
        note: "claim-test reset",
        resolvedBy: ACTOR,
      },
      { actor: ACTOR, source: "system" },
    );
    console.log(`reset: closed ${item.type} worklist item ${item.id}`);
  }
}

async function main(): Promise<number> {
  if (!(await confirmHost())) return 1;

  if (flag("--reset")) await reset();

  // Upsert the listing as an import-style DRAFT: drafts are the claimable
  // state, and a draft never renders on the public directory surfaces.
  const existing = (await getDirectoryListingsAdmin()).find((r) => r.id === TEST_ID);
  await saveDirectoryListing(record, {
    actor: ACTOR,
    source: "admin",
    status: "draft",
  });
  console.log(`${existing ? "refreshed" : "created"} directory draft ${TEST_ID} («${TEST_NAME}»)`);

  const emails = [...DEFAULT_EMAILS, ...optAll("--email")];
  const inserted = await upsertClaimContacts(
    emails.map((email) => ({
      subjectStore: STORE,
      subjectId: TEST_ID,
      email,
      source: ACTOR,
      createdBy: ACTOR,
    })),
  );
  const onFile = await listClaimContacts(STORE, TEST_ID);
  console.log(
    `roster contacts on file for the test listing: ${onFile.length} (${inserted} new). ` +
      "Claiming with one of those emails auto-approves; any other email queues for the Chamber.",
  );
  console.log("Ready: open /claim, search “test”, and run the flow.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("HALT:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
