// Authorization (E06): the five-role model and the single `can()` seam.
//
// This replaces v1's `canEdit(user, id)` — a two-line check that hard-coded
// "admin or linked" and had no room for a fourth role, let alone paid tiers.
// `can(user, action, resource)` is one of the four pre-built monetization
// choke points (with rankListings(), resolveMapView(), and feed keys): later
// epics extend it WITHOUT touching auth again —
//   E08 moderation queue  -> consumes "moderate"
//   E10 admin shell       -> consumes "view-reports"
//   E16 AMS entitlements  -> populates org.entitlements
//   E19 monetization      -> makes entitlements decide
//
// Everything here is SYNCHRONOUS and pure. That is deliberate: the portal
// server pages call it inline while rendering, and an async can() would force
// an await into every one of those call sites. The data it needs (the org's
// linked ids and entitlements) is joined once by getSessionUser().
//
// No import of next/headers, the DB, or anything request-bound — so the
// matrix below is exhaustively unit-testable as plain function calls.

import type { Role } from "@/lib/db/schema";

export type { Role };

/** The closed set of things anyone can attempt. Deliberately small: a new
 *  action is a deliberate act with a test-matrix row, not an ad-hoc string. */
export type Action =
  | "edit-record"
  | "manage-accounts"
  | "moderate"
  | "view-reports"
  | "manage-site";

/** What is being acted on. A bare string is shorthand for a record id, which
 *  is how the ported v1 call sites (`canEdit(user, id)`) read. */
export type Resource =
  | string
  | { kind: string; id: string; ownerOrgId?: string | null };

/** The caller. Built by getSessionUser(); never constructed from client input. */
export interface AuthSubject {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** null for Chamber staff (admin / moderator / viewer). */
  orgId: string | null;
  /** The org's linked_ids, resolved at session load so can() stays sync.
   *  Empty for staff roles — staff authority comes from the role, not a list. */
  editableIds: string[];
  /** The org's entitlements seam (E16 populates, E19 decides). `{}` today. */
  entitlements: Record<string, unknown>;
}

/** Roles that own content through an org. */
const ORG_ROLES: readonly Role[] = ["org-editor", "member-business"];

function resourceId(resource: Resource | undefined): string | undefined {
  if (resource === undefined) return undefined;
  return typeof resource === "string" ? resource : resource.id;
}

function resourceOwnerOrgId(resource: Resource | undefined): string | null | undefined {
  if (resource === undefined || typeof resource === "string") return undefined;
  return resource.ownerOrgId;
}

/**
 * Base decision: what the ROLE alone permits, before entitlements are
 * consulted. Kept separate so the entitlement layer has exactly one input to
 * reason about, and so this table can be read as the whole role model.
 */
function roleAllows(
  user: AuthSubject,
  action: Action,
  resource: Resource | undefined,
): boolean {
  // admin -> everything. The one role with no resource scoping.
  if (user.role === "admin") return true;

  switch (action) {
    case "edit-record": {
      if (!ORG_ROLES.includes(user.role)) return false;
      // Stored-record-decides (preserved from v1): the id/ownerOrgId compared
      // here always comes from the record the server loaded, never from a
      // client-sent field. Ownership by org id is the stronger signal when the
      // record carries one; the linked-id list is the ported v1 path.
      const ownerOrgId = resourceOwnerOrgId(resource);
      if (ownerOrgId !== undefined && ownerOrgId !== null) {
        return user.orgId !== null && user.orgId === ownerOrgId;
      }
      const id = resourceId(resource);
      return id !== undefined && user.editableIds.includes(id);
    }
    // E08 builds the queue behind this.
    case "moderate":
      return user.role === "moderator";
    // E10's reporting/grant views.
    case "view-reports":
      return user.role === "viewer";
    // Accounts, invites, resets, backups, site config: admin only. `viewer` is
    // read-only everywhere and never satisfies these.
    case "manage-accounts":
    case "manage-site":
      return false;
    default: {
      // Exhaustiveness: adding an Action without a rule here fails typecheck
      // rather than silently defaulting to "allowed".
      const never: never = action;
      return never;
    }
  }
}

/**
 * The monetization seam (E19). Runs on EVERY decision, including for staff, so
 * the call shape is fixed before entitlements carry any weight.
 *
 * Today `org.entitlements` is always `{}` — E16 is what starts populating it —
 * so this is a no-op that returns `base` unchanged.
 *
 * ── BINDING CONTRACT: entitlements NARROW, they never widen. ──────────────
 * An entitlement may turn an allowed action into a denied one (a lapsed org
 * loses event editing). It may NEVER turn a denied action into an allowed one.
 * Therefore `roleAllows()` is the permanent CEILING on what any account can
 * do, and this function can only subtract.
 *
 * Why, so E19 does not "improve" it: `entitlements` is a jsonb blob that E16
 * syncs from an external AMS the Chamber does not control. Under a widening
 * contract, a bad sync, a hand-edited row, or a spoofed upstream field would
 * be a privilege ESCALATION — the blob could mint capability the role model
 * never granted. Under this narrowing contract the worst case is a paying org
 * losing access it should have: visible, reversible, and loud, rather than
 * silent. It also keeps "what can this account do?" answerable from the role
 * table alone, which is what the account list and every future audit rely on.
 *
 * The empty-entitlements early return is not just an optimization — it is the
 * statement that an unprovisioned org is UNRESTRICTED, not unprivileged.
 */
function applyEntitlements(
  base: boolean,
  user: AuthSubject,
  action: Action,
  _resource: Resource | undefined,
): boolean {
  // A denied action stays denied — no entitlement can grant privilege.
  if (!base) return false;

  // Entitlements are per-org; Chamber staff have no org and are never gated by
  // a paid tier.
  if (user.orgId === null) return base;

  const entitlements = user.entitlements;
  // Unprovisioned org: no restrictions to apply (see contract above).
  if (!entitlements || Object.keys(entitlements).length === 0) return base;

  // E19 wires the real tier lookup here — a pure function of
  // (entitlements, action) that may only return false to REVOKE `base`.
  // Until then a populated blob still restricts nothing.
  void action;
  return base;
}

/**
 * The single authorization question in the app.
 *
 * Usage:  can(user, "edit-record", listingId)
 *         can(user, "edit-record", { kind: "event", id, ownerOrgId })
 *         can(user, "manage-accounts")
 */
export function can(
  user: AuthSubject,
  action: Action,
  resource?: Resource,
): boolean {
  return applyEntitlements(roleAllows(user, action, resource), user, action, resource);
}

// ---------- route gates ----------
//
// Every /api/admin/** and /api/portal/** handler calls one of these. v1 had
// ~12 divergent copies of this logic (some private, some inlined, one
// returning 403 where every other returned 401); E06 collapses them to these
// three, and tests/unit/authz-gate-coverage.test.ts fails CI if a route file
// stops referencing one.
//
// Contract, normalized across every route: NOT SIGNED IN -> 401.
// SIGNED IN BUT WRONG ROLE -> 403. Returning `null` means "proceed".

/** Uniform shapes so no endpoint leaks whether an account exists. */
export const UNAUTHENTICATED = { error: "Sign in first" } as const;
export const FORBIDDEN = { error: "You do not have access to that" } as const;

export function unauthorizedResponse(): Response {
  return Response.json(UNAUTHENTICATED, { status: 401 });
}

export function forbiddenResponse(): Response {
  return Response.json(FORBIDDEN, { status: 403 });
}

/**
 * Gate a decision you have already made.
 * Returns the Response to send, or null when the caller may proceed.
 */
export function gate(user: AuthSubject | null, allowed: boolean): Response | null {
  if (!user) return unauthorizedResponse();
  if (!allowed) return forbiddenResponse();
  return null;
}
