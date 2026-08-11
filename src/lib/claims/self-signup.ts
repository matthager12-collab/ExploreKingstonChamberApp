// Self-serve claim signup (E17 claim-signup slice) — the rules, in ONE place.
//
// The flow this module owns, decided with Mat 2026-08-11:
//
//   1. START — a visitor picks a listing, gives name + email + password. We
//      hold everything as a claim_signup row (password HASHED, code HASHED)
//      and email a 6-digit code. No account, no session, no rights yet.
//   2. VERIFY — the code comes back. Now the mailbox is proven, so the
//      account + org are created in one transaction. If the email is on the
//      Chamber's roster FOR THAT LISTING (claim_contact), the claim lands
//      immediately — grant + ownership stamp, exactly the two halves an
//      invite redemption lands. Otherwise the claim opens a chamber worklist
//      item and the account waits, signed in but rights-free.
//   3. SIGNED-IN CLAIM — an existing portal account asks for another
//      listing. Same match rule against their session email; no code
//      round-trip (login already proved the mailbox).
//
// Relationship to the older flows, deliberately:
//   - claim_request (the "chamber calls you" intake) stays as the no-email
//     fallback; this module does not touch it.
//   - The invite console remains the Chamber-initiated path; approval of a
//     pending claim_signup uses the SAME grant + stamp helpers, so "claimed"
//     keeps exactly one meaning (the union ownership.ts defines).
//
// Oracle posture: START never reads claim_contact and answers identically
// whether or not the email is on file — whether an address is on the roster
// is only ever revealed to someone who has just proven they control it.
// Directory DRAFTS are deliberately visible here (they are what gets
// claimed, and /claim lists them by name); the other stores stay live-only,
// same as /api/claim.

import "server-only";

import {
  AuthError,
  findUserByEmail,
  getOrg,
  addOrgLinkedIds,
  listOrganizations,
  toPublicUser,
  type PublicUser,
} from "@/lib/auth/identity";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/identity";
import {
  generateId,
  generateVerificationCode,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/tokens";
import type { OrgKind, Role } from "@/lib/auth/roles";
import { selfSignupTx, type UserRow } from "@/lib/db/auth-store";
import {
  consumeClaimSignup,
  bumpClaimSignupAttempts,
  findClaimSignup,
  hasClaimContact,
  insertClaimSignup,
  normalizeEmail,
  reapExpiredClaimSignups,
} from "@/lib/db/claim-store";
import { sendEmail } from "@/lib/email";
import {
  backfillLinkedOwnership,
  findClaimedLinkedRecords,
  OwnershipConflictError,
} from "@/lib/ownership";
import { getCharities } from "@/lib/stores/charity-store";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { getRestaurants } from "@/lib/stores/business-store";
import { createWorklistItem, resolveItem } from "@/lib/stores/worklist-store";
import { validateWorklistPayload } from "@/lib/schemas/worklist";
import { CLAIM_INVITE_ROLE_BY_STORE, isClaimStore, type ClaimStore } from "./roles";

export { isClaimStore } from "./roles";
export { OwnershipConflictError } from "@/lib/ownership";

/** Thrown when the named listing does not exist in this flow's view of the
 *  store (routes map it to a 404). */
export class ClaimSubjectNotFoundError extends Error {}

/** Minutes a signup row stays verifiable. Short on purpose: the row holds a
 *  password hash for an account that does not exist yet. */
export const CODE_TTL_MINUTES = 15;

/** A 6-digit space is ~10^6; five guesses cannot meaningfully search it. */
export const MAX_CODE_ATTEMPTS = 5;

const invalidCode = () =>
  new AuthError("That code is invalid or has expired — please start again.");

const alreadyClaimed = () =>
  new OwnershipConflictError(
    "This listing has already been claimed — contact the Chamber if that seems wrong.",
  );

/** store → role is the console's law (CLAIM_INVITE_ROLE_BY_STORE); role →
 *  org kind is mintInvite's. Composed here so a self-signup and an invite
 *  produce byte-identical org/user shapes for the same store. */
function roleForStore(store: ClaimStore): Role {
  return CLAIM_INVITE_ROLE_BY_STORE[store];
}
function kindForStore(store: ClaimStore): OrgKind {
  return roleForStore(store) === "member-business" ? "business" : "nonprofit";
}

/** The claim flow's view of each store. Directory reads through the ADMIN
 *  getter on purpose — imported DRAFTS are the normal claimable state and
 *  /claim already lists their names — while the curated stores keep the
 *  live-only, no-draft-oracle posture of /api/claim. */
async function findClaimSubject(
  store: ClaimStore,
  id: string,
): Promise<{ id: string; name: string } | undefined> {
  const records: { id: string; name: string }[] =
    store === "restaurants"
      ? await getRestaurants()
      : store === "lodging"
        ? await getLodging()
        : store === "charities"
          ? await getCharities()
          : await getDirectoryListingsAdmin();
  return records.find((r) => r.id === id);
}

/** Refuse when ANY org already holds either half of a claim on the listing. */
async function assertUnclaimed(
  store: ClaimStore,
  id: string,
  ignoreOrgId: string | null = null,
): Promise<void> {
  const claimed = await findClaimedLinkedRecords(
    kindForStore(store),
    [id],
    await listOrganizations(),
    { ignoreOrgId },
  );
  if (claimed.length > 0) throw alreadyClaimed();
}

/** Land both halves of a claim — grant first, stamp second, the redemption
 *  order (if only one half lands, keep the one that lets the owner work).
 *  Never throws: by the time this runs the account/approval is committed and
 *  the caller must not strand the person. Failures log with enough detail
 *  for the claims console's mismatch states to surface them. */
async function landClaim(
  store: ClaimStore,
  id: string,
  orgId: string,
  actor: string,
  opts: { grantAlreadyLanded: boolean; source?: "admin" | "portal" | "public" },
): Promise<void> {
  if (!opts.grantAlreadyLanded) {
    try {
      await addOrgLinkedIds(orgId, [id], actor, opts.source ?? "public");
    } catch (err) {
      console.error("claim-signup linked-id grant failed", {
        orgId,
        store,
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  try {
    const outcome = await backfillLinkedOwnership(kindForStore(store), [id], orgId, actor);
    if (!outcome.complete) {
      console.error("claim-signup ownership backfill incomplete", {
        orgId,
        requested: outcome.requested,
        stamped: outcome.stamped,
        skipped: outcome.skipped,
        failed: outcome.failed,
      });
    }
  } catch (err) {
    console.error("claim-signup ownership backfill failed", {
      orgId,
      store,
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Every claim leaves a worklist trail: OPEN for the Chamber to decide, or
 *  created-and-resolved as the audit crumb of an auto-approval. Best-effort
 *  by design — the claim itself has already committed. */
async function recordClaimWorklist(args: {
  store: ClaimStore;
  id: string;
  subjectLabel: string;
  applicantName: string;
  applicantEmail: string;
  userId: string;
  orgId: string;
  verifiedBy: "code" | "session";
  autoApproved: boolean;
}): Promise<void> {
  try {
    const payload = validateWorklistPayload("claim_signup", {
      store: args.store,
      id: args.id,
      applicantName: args.applicantName,
      applicantEmail: args.applicantEmail,
      userId: args.userId,
      orgId: args.orgId,
      verifiedBy: args.verifiedBy,
      count: 1,
    });
    const created = await createWorklistItem(
      {
        type: "claim_signup",
        subjectStore: args.store,
        subjectId: args.id,
        subjectLabel: args.subjectLabel,
        payload,
      },
      { actor: args.applicantEmail, source: "public" },
    );
    if (args.autoApproved) {
      await resolveItem(
        created.item.id,
        {
          resolution: "approved",
          note: "auto-approved: applicant's verified email is on the Chamber roster for this listing",
          resolvedBy: "system:roster-match",
        },
        { actor: "system:roster-match", source: "system" },
      );
    }
  } catch (err) {
    console.error("claim-signup worklist record failed", {
      store: args.store,
      id: args.id,
      autoApproved: args.autoApproved,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------- step 1: start ----------

export interface StartClaimSignupResult {
  signupId: string;
  /** false only in non-production with email unconfigured — the code went to
   *  the server log instead (dev loop without a Resend key). */
  emailSent: boolean;
}

/** Sending failed outright (or email is unconfigured in production). The
 *  caller should tell the human to try later or use the no-email path —
 *  nothing was created. */
export class CodeEmailUnavailableError extends Error {}

export async function startClaimSignup(input: {
  store: string;
  id: string;
  name: string;
  email: string;
  password: string;
}): Promise<StartClaimSignupResult> {
  if (!isClaimStore(input.store)) throw new AuthError("unknown store");
  const store = input.store;
  const id = input.id.trim();
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!id) throw new AuthError("id required");
  if (!name) throw new AuthError("your name is required");
  if (name.length > 200) throw new AuthError("name is too long");
  // Light shape check only — the code round-trip is the real validation.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new AuthError("that email address does not look right");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be ${MIN_PASSWORD_LENGTH}+ characters`);
  }

  const subject = await findClaimSubject(store, id);
  if (!subject) throw new ClaimSubjectNotFoundError("record not found");
  await assertUnclaimed(store, id);

  // Hygiene, not correctness: expired rows hold password hashes for no one.
  await reapExpiredClaimSignups().catch(() => {});

  const code = generateVerificationCode();
  const signupId = generateId();

  // Send BEFORE inserting: a row is only worth keeping if its code is in
  // someone's inbox (or, in dev without a key, in the server log).
  const sent = await sendEmail({
    to: email,
    subject: "Your Explore Kingston verification code",
    text:
      `Your verification code is: ${code}\n\n` +
      `Enter it on the claim page for “${subject.name}” within ${CODE_TTL_MINUTES} minutes.\n\n` +
      `If you didn't request this, you can ignore this email — nothing changes without the code.`,
  });
  let emailSent = true;
  if (!sent.sent) {
    if (sent.reason === "email-disabled" && process.env.NODE_ENV !== "production") {
      // Dev loop without RESEND_API_KEY: the log is the inbox. Never in prod.
      console.log(`[claim-signup] dev verification code for ${email}: ${code}`);
      emailSent = false;
    } else {
      throw new CodeEmailUnavailableError(
        "We couldn't send the verification email just now — please try again shortly.",
      );
    }
  }

  await insertClaimSignup({
    id: signupId,
    subjectStore: store,
    subjectId: id,
    subjectLabel: subject.name,
    name,
    email,
    passwordHash: hashPassword(input.password),
    codeHash: hashPassword(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
  });

  return { signupId, emailSent };
}

// ---------- step 2: verify ----------

export interface VerifyClaimSignupResult {
  user: UserRow;
  publicUser: PublicUser;
  /** true = roster match, claim landed, they own the listing right now. */
  approved: boolean;
}

export async function verifyClaimSignup(input: {
  signupId: string;
  code: string;
}): Promise<VerifyClaimSignupResult> {
  const row = await findClaimSignup(input.signupId.trim());
  if (!row) throw invalidCode();
  if (row.consumedAt) throw invalidCode();
  if (row.expiresAt.getTime() <= Date.now()) throw invalidCode();

  // Count the guess BEFORE checking it — the cap is what makes a 6-digit
  // code safe, so a crash may only ever over-count, never under-count.
  const attempts = await bumpClaimSignupAttempts(row.id);
  if (attempts > MAX_CODE_ATTEMPTS) throw invalidCode();
  if (!verifyPassword(input.code.trim(), row.codeHash)) throw invalidCode();

  const store = row.subjectStore as ClaimStore;
  if (!isClaimStore(store)) throw invalidCode(); // cannot happen; belt and braces

  // The mailbox is proven from here on — errors may now be specific.
  const existing = await findUserByEmail(row.emailLower);
  if (existing) {
    await consumeClaimSignup(row.id);
    throw new AuthError(
      "You already have an account with that email — sign in, then claim the listing from its page.",
    );
  }

  // A claim that landed between start and verify refuses cleanly, before any
  // row is created (same advisory-precheck posture as invite redemption).
  await assertUnclaimed(store, row.subjectId);

  const approved = await hasClaimContact(store, row.subjectId, row.emailLower);

  const { user, org } = await selfSignupTx({
    org: {
      id: generateId(),
      name: row.subjectLabel,
      kind: kindForStore(store),
      // The grant half lands inside the transaction on a roster match —
      // mirrors redeemInviteTx's buildOrg carrying the invite's linkedIds.
      linkedIds: approved ? [row.subjectId] : [],
    },
    user: {
      id: generateId(),
      email: row.emailLower,
      name: row.name,
      role: roleForStore(store),
      passwordHash: row.passwordHash,
    },
    actor: row.emailLower,
  });

  await consumeClaimSignup(row.id);

  if (approved) {
    await landClaim(store, row.subjectId, org.id, row.emailLower, {
      grantAlreadyLanded: true,
    });
  }
  await recordClaimWorklist({
    store,
    id: row.subjectId,
    subjectLabel: row.subjectLabel,
    applicantName: row.name,
    applicantEmail: row.emailLower,
    userId: user.id,
    orgId: org.id,
    verifiedBy: "code",
    autoApproved: approved,
  });

  return { user, publicUser: toPublicUser(user), approved };
}

// ---------- chamber approval of a pending claim ----------

/**
 * Land a claim the Chamber just approved from the worklist. The org and
 * account already exist (verify created them); this grants edit rights and
 * stamps ownership — the same two halves, through the same helpers, as an
 * auto-approval or an invite redemption.
 *
 * Throws AuthError / OwnershipConflictError / ClaimSubjectNotFoundError for
 * conditions the admin should read as a refusal (listing gone, claimed by
 * someone else meanwhile, org deleted). The caller resolves the worklist item
 * only after this returns.
 */
export async function approvePendingClaimSignup(args: {
  store: string;
  id: string;
  orgId: string;
  actor: string;
}): Promise<void> {
  if (!isClaimStore(args.store)) throw new AuthError("unknown store");
  const store = args.store;
  const org = await getOrg(args.orgId);
  if (!org) {
    throw new AuthError(
      "That organization no longer exists — the account may have been deleted. Decline the item instead.",
    );
  }
  const subject = await findClaimSubject(store, args.id);
  if (!subject) throw new ClaimSubjectNotFoundError("record not found");
  // ignoreOrgId makes a re-click after a half-landed approval converge
  // instead of refusing on its own grant.
  await assertUnclaimed(store, args.id, org.id);
  await landClaim(store, args.id, org.id, args.actor, {
    grantAlreadyLanded: false,
    source: "admin",
  });
}

// ---------- signed-in claim ----------

export interface SignedInClaimResult {
  approved: boolean;
  subjectLabel: string;
}

/** An existing portal account claiming a further listing. No code round-trip:
 *  the session already proved the mailbox. Same roster rule, same helpers. */
export async function claimAsSignedIn(
  user: Pick<UserRow, "id" | "email" | "name" | "role" | "orgId">,
  input: { store: string; id: string },
): Promise<SignedInClaimResult> {
  if (!isClaimStore(input.store)) throw new AuthError("unknown store");
  const store = input.store;
  const id = input.id.trim();
  if (!id) throw new AuthError("id required");

  if (!user.orgId) {
    throw new AuthError(
      "Your account is Chamber staff — use the admin console to manage listings.",
    );
  }
  const org = await getOrg(user.orgId);
  if (!org) throw new AuthError("Your account's organization no longer exists — contact the Chamber.");
  if (org.kind !== kindForStore(store)) {
    throw new AuthError(
      org.kind === "business"
        ? "Your account manages a business — nonprofit listings are claimed separately."
        : "Your account manages a nonprofit — business listings are claimed separately.",
    );
  }

  const subject = await findClaimSubject(store, id);
  if (!subject) throw new ClaimSubjectNotFoundError("record not found");
  if (org.linkedIds.includes(id)) {
    throw new AuthError("You already manage this listing — it's in your portal.");
  }
  await assertUnclaimed(store, id, org.id);

  const email = normalizeEmail(user.email);
  const approved = await hasClaimContact(store, id, email);

  if (approved) {
    // Grant via the portal source (a signed-in self-service write), then the
    // stamp — landClaim's usual order.
    try {
      await addOrgLinkedIds(org.id, [id], email, "portal");
    } catch (err) {
      console.error("claim-signup signed-in grant failed", {
        orgId: org.id,
        store,
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new AuthError("Something went wrong landing the claim — contact the Chamber.");
    }
    await landClaim(store, id, org.id, email, { grantAlreadyLanded: true });
  }
  await recordClaimWorklist({
    store,
    id,
    subjectLabel: subject.name,
    applicantName: user.name,
    applicantEmail: email,
    userId: user.id,
    orgId: org.id,
    verifiedBy: "session",
    autoApproved: approved,
  });

  return { approved, subjectLabel: subject.name };
}
