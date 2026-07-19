// The can() authorization matrix (E06) — 5 roles x 5 actions x 3 resource
// contexts, enumerated exhaustively rather than spot-checked.
//
// Why exhaustive: v1's authorization was `admin || linkedIds.includes(id)`,
// small enough to eyeball. The five-role model is not, and roles that have no
// UI yet (moderator, viewer) are exactly the ones a reviewer cannot check by
// clicking. The table below IS the role model — if a future epic changes a
// rule, it changes here, visibly, in review.
//
// can() is pure and synchronous, so this suite needs no database.

import { describe, expect, it } from "vitest";

import { can, type Action, type AuthSubject } from "@/lib/auth/authz";
import { ROLES, type Role } from "@/lib/db/schema";

const ACTIONS: Action[] = [
  "edit-record",
  "manage-accounts",
  "moderate",
  "view-reports",
  "manage-site",
];

const OWN_ORG = "org-own";
const OTHER_ORG = "org-other";
const OWN_ID = "listing-own";
const OTHER_ID = "listing-other";

function subject(role: Role): AuthSubject {
  const isOrgRole = role === "org-editor" || role === "member-business";
  return {
    id: `u-${role}`,
    email: `${role}@example.test`,
    name: role,
    role,
    orgId: isOrgRole ? OWN_ORG : null,
    editableIds: isOrgRole ? [OWN_ID] : [],
    entitlements: {},
  };
}

/** The three resource contexts an action can be attempted in. */
const CONTEXTS = {
  /** A record this org owns (by linked id). */
  own: OWN_ID,
  /** A record another org owns. */
  other: OTHER_ID,
  /** No resource — the unscoped/staff-capability form. */
  none: undefined,
} as const;
type Context = keyof typeof CONTEXTS;

/**
 * Expected verdicts. Read it as: for this role, which (action, context) pairs
 * are permitted? Anything not listed is DENIED — the table is closed, so a
 * new permission cannot appear by omission.
 */
const EXPECTED: Record<Role, Partial<Record<Action, Context[]>>> = {
  // Everything, in every context, unscoped by resource.
  admin: {
    "edit-record": ["own", "other", "none"],
    "manage-accounts": ["own", "other", "none"],
    moderate: ["own", "other", "none"],
    "view-reports": ["own", "other", "none"],
    "manage-site": ["own", "other", "none"],
  },
  // E08's queue only. Explicitly NOT accounts/invites/resets/backup.
  moderator: { moderate: ["own", "other", "none"] },
  // Their own org's records, and nothing else anywhere.
  "org-editor": { "edit-record": ["own"] },
  "member-business": { "edit-record": ["own"] },
  // Read-only reporting. No writes anywhere, ever.
  viewer: { "view-reports": ["own", "other", "none"] },
};

describe("can() — full role x action x resource matrix", () => {
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      for (const context of Object.keys(CONTEXTS) as Context[]) {
        const expected = (EXPECTED[role][action] ?? []).includes(context);
        it(`${role} / ${action} / ${context}-resource -> ${expected ? "ALLOW" : "DENY"}`, () => {
          expect(can(subject(role), action, CONTEXTS[context])).toBe(expected);
        });
      }
    }
  }

  it("covers every role and every action (guards against a silently added case)", () => {
    expect(ROLES).toHaveLength(5);
    expect(ACTIONS).toHaveLength(5);
  });
});

describe("edit-record ownership is decided by the STORED record, not the caller", () => {
  it("allows an org role to edit a record whose ownerOrgId is its own org", () => {
    expect(
      can(subject("org-editor"), "edit-record", {
        kind: "charity",
        id: "any-id-at-all",
        ownerOrgId: OWN_ORG,
      }),
    ).toBe(true);
  });

  it("denies a record owned by another org even when its id is in editableIds", () => {
    // The stale-linked-id case: ownership moved, the user's list did not.
    // ownerOrgId is the stronger signal and must win.
    expect(
      can(subject("member-business"), "edit-record", {
        kind: "restaurant",
        id: OWN_ID,
        ownerOrgId: OTHER_ORG,
      }),
    ).toBe(false);
  });

  it("denies when the resource carries no owner and the id is not linked", () => {
    expect(can(subject("member-business"), "edit-record", OTHER_ID)).toBe(false);
  });

  it("denies an org role with an empty editableIds list", () => {
    const stripped = { ...subject("org-editor"), editableIds: [] };
    expect(can(stripped, "edit-record", OWN_ID)).toBe(false);
  });

  it("admins are not resource-scoped", () => {
    expect(
      can(subject("admin"), "edit-record", {
        kind: "restaurant",
        id: OTHER_ID,
        ownerOrgId: OTHER_ORG,
      }),
    ).toBe(true);
  });
});

describe("entitlements seam (E19) — narrows, never widens", () => {
  it("an empty entitlements blob restricts nothing (unprovisioned != unprivileged)", () => {
    expect(can(subject("member-business"), "edit-record", OWN_ID)).toBe(true);
  });

  it("a populated blob does not grant an action the role denies", () => {
    // The contract: no entitlement value can escalate privilege. E16 syncs
    // this blob from an external AMS, so a widening contract would make a bad
    // sync a privilege grant.
    const paid: AuthSubject = {
      ...subject("member-business"),
      entitlements: { tier: "premium", manageAccounts: true, moderate: true, admin: true },
    };
    expect(can(paid, "manage-accounts")).toBe(false);
    expect(can(paid, "moderate")).toBe(false);
    expect(can(paid, "manage-site")).toBe(false);
    expect(can(paid, "edit-record", OTHER_ID)).toBe(false);
  });

  it("a populated blob does not change a staff decision (staff have no org)", () => {
    const staff: AuthSubject = {
      ...subject("viewer"),
      entitlements: { tier: "premium" },
    };
    expect(can(staff, "view-reports")).toBe(true);
    expect(can(staff, "edit-record", OWN_ID)).toBe(false);
  });

  it("today entitlements are inert: a populated blob still permits what the role allows", () => {
    const paid: AuthSubject = {
      ...subject("org-editor"),
      entitlements: { tier: "basic" },
    };
    expect(can(paid, "edit-record", OWN_ID)).toBe(true);
  });
});
