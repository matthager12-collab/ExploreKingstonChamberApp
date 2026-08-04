// Batch invite minting for member onboarding — launch scope: EVERY listed
// business (restaurants AND lodging) gets a member-business portal invite
// linked to its listing, without clicking /admin/accounts 22 times.
//
//   npm run invites:mint                                     (dry-run, default)
//   npm run invites:mint -- --execute --skip-existing --out invites.csv
//
// Flags:
//   --execute          actually mint (the default is a dry-run plan; writes nothing)
//   --only <id,id>     restrict to specific listing ids
//   --include-directory  ALSO sweep the directory domain (imported member
//                      listings, drafts included — they are what gets
//                      claimed). Off by default so the pre-E16 invocation
//                      keeps minting exactly restaurants+lodging; with ~150
//                      imported members this flag changes the mint count by
//                      an order of magnitude, so pair it with --only or
//                      --skip-existing deliberately.
//   --skip-existing    skip listings already covered by an ACTIVE invite or by
//                      an account whose org is linked to the listing
//   --out <file>       write the CSV to a file instead of stdout
//   --base-url <url>   origin for the join-URL column (default: NEXT_PUBLIC_SITE_URL)
//   --actor <email>    audit-trail actor recorded on each mint
//                      (default: "scripts/mint-invites")
//
// Every mint goes through src/lib/invite-mint.ts — the SAME validation +
// createInvite path POST /api/portal/invites uses — so a script-minted invite
// is indistinguishable from an admin-UI one (14-day expiry, revocable at
// /admin/accounts, audit-rowed).
//
// Output discipline: stdout carries ONLY the CSV (business name, listing id,
// invite code, join URL, expiry) so it can go straight into a mail-merge;
// every diagnostic goes to stderr. Prefer --out (or `npm run -s`) — npm's own
// run banner also lands on stdout. The Chamber sends the codes from its own
// inbox; this script NEVER sends anything.
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { writeFileSync } from "node:fs";

import {
  inviteState,
  listInvites,
  listOrganizations,
  listUsers,
} from "../src/lib/auth/identity";
import { mintInvite } from "../src/lib/invite-mint";
import { siteUrl } from "../src/lib/site-url";
import { getRestaurants } from "../src/lib/stores/business-store";
import { getDirectoryListingsAdmin } from "../src/lib/stores/directory-store";
import { getLodging } from "../src/lib/stores/listing-stores";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const log = (line: string) => console.error(line);

if (flag("--help") || flag("-h")) {
  log(
    "Usage: npm run invites:mint -- [--execute] [--only id,id] [--skip-existing]\n" +
      "                               [--out file.csv] [--base-url https://host] [--actor email]",
  );
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  log("DATABASE_URL must be set (invites are minted into the app database).");
  process.exit(1);
}

const execute = flag("--execute");
const skipExisting = flag("--skip-existing");
const outFile = opt("--out");
const actor = opt("--actor") ?? "scripts/mint-invites";
const baseUrl = (opt("--base-url") ?? siteUrl()).replace(/\/+$/, "");
// E17: each row's join URL carries ?code=, so the link alone lands the owner
// on a pre-filled form; the code stays in its own column for mail-merges that
// want to mention it in prose.
const joinUrl = `${baseUrl}/portal/join`;
const joinLinkFor = (code: string) => `${joinUrl}?code=${encodeURIComponent(code)}`;

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL!).host;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
})();

/** RFC-4180 field escaping: quote when the value needs it. */
const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main(): Promise<number> {
  // The merged public stores: git seed + live overlay, exactly what the site
  // lists. Restaurants first, then lodging — stable, store order. The
  // directory sweep is the ADMIN read (drafts included) on purpose: imported
  // drafts are what gets claimed, and invite-mint validates against the same
  // universe.
  const [restaurants, lodging, directory] = await Promise.all([
    getRestaurants(),
    getLodging(),
    flag("--include-directory") ? getDirectoryListingsAdmin() : Promise.resolve([]),
  ]);
  let listings = [
    ...restaurants.map((r) => ({ id: r.id, name: r.name, kind: "restaurant" as const })),
    ...lodging.map((l) => ({ id: l.id, name: l.name, kind: "lodging" as const })),
    ...directory.map((d) => ({ id: d.id, name: d.name, kind: "directory" as const })),
  ];

  const only = opt("--only");
  if (only !== undefined) {
    const wanted = only
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (wanted.length === 0) {
      log("--only needs a comma-separated list of listing ids");
      return 1;
    }
    const known = new Set(listings.map((l) => l.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      log(`--only: unknown listing id(s): ${unknown.join(", ")}`);
      return 1;
    }
    const keep = new Set(wanted);
    listings = listings.filter((l) => keep.has(l.id));
  }

  // A listing is "covered" when an ACTIVE invite already points at it (its own
  // linkedIds, or those of the org the invite joins), or when an org linked to
  // it already has at least one account. Expired/revoked/used invites do NOT
  // cover — a business that let its code lapse should be re-invited.
  const covered = new Map<string, string>(); // listing id -> reason
  if (skipExisting) {
    const [invites, orgs, users] = await Promise.all([
      listInvites(),
      listOrganizations(),
      listUsers(),
    ]);
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    const orgsWithUsers = new Set(users.map((u) => u.orgId).filter(Boolean));
    for (const org of orgs) {
      if (!orgsWithUsers.has(org.id)) continue;
      for (const id of org.linkedIds) covered.set(id, `account exists (org "${org.name}")`);
    }
    for (const invite of invites) {
      if (inviteState(invite) !== "active") continue;
      const ids = [
        ...invite.linkedIds,
        ...(invite.orgId ? (orgById.get(invite.orgId)?.linkedIds ?? []) : []),
      ];
      for (const id of ids) covered.set(id, `active invite ${invite.code}`);
    }
  }

  const toMint = listings.filter((l) => !covered.has(l.id));
  const skipped = listings.filter((l) => covered.has(l.id));

  log(`${execute ? "MINTING" : "DRY RUN"} against ${host}`);
  for (const l of skipped) log(`  skip (${covered.get(l.id)})  ${l.id}  ${l.name}`);

  if (!execute) {
    for (const l of toMint) log(`  would mint [${l.kind}]  ${l.id}  ${l.name}`);
    log(
      `Dry run: ${toMint.length} invite(s) would be minted, ${skipped.length} skipped. ` +
        "Nothing was written — re-run with --execute to mint.",
    );
    return 0;
  }

  if (baseUrl.startsWith("http://localhost")) {
    log(
      `WARNING: join URLs will point at ${baseUrl} — set NEXT_PUBLIC_SITE_URL or pass --base-url.`,
    );
  }

  const rows: string[] = ["business_name,listing_id,invite_code,join_url,expires"];
  let failure: unknown = null;
  for (const l of toMint) {
    try {
      const invite = await mintInvite(
        {
          role: "member-business",
          linkedIds: [l.id],
          // Redeeming creates the business's org, named after the listing.
          newOrgName: l.name,
          note: `Launch onboarding — ${l.name}`,
        },
        actor,
      );
      rows.push(
        [
          l.name,
          l.id,
          invite.code,
          joinLinkFor(invite.code),
          invite.expiresAt.toISOString().slice(0, 10),
        ]
          .map(csvField)
          .join(","),
      );
      log(`  minted [${l.kind}]  ${l.id}  ${l.name}`);
    } catch (err) {
      failure = err;
      log(`  FAILED  ${l.id}  ${l.name}: ${err instanceof Error ? err.message : String(err)}`);
      break; // fail fast; already-minted codes stay valid (and revocable)
    }
  }

  const csv = rows.join("\n") + "\n";
  if (rows.length > 1) {
    if (outFile) {
      writeFileSync(outFile, csv);
      log(`Wrote ${rows.length - 1} invite(s) to ${outFile}`);
    } else {
      process.stdout.write(csv);
    }
  }

  if (failure) {
    log(
      "Stopped after a failed mint. Codes already minted above are live (revocable at " +
        "/admin/accounts); fix the cause and re-run with --skip-existing to fill the gaps.",
    );
    return 1;
  }
  log(`Minted ${rows.length - 1} invite(s); ${skipped.length} skipped.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("HALT:", err);
    process.exit(1);
  });
