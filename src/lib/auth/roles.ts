// The role vocabulary (E06) — the ONE definition of it in the codebase.
//
// This module deliberately imports NOTHING. Both the Drizzle schema
// (src/lib/db/db auth-schema.ts) and client components (admin/accounts/manager.tsx)
// need these names; if they lived with the schema, importing the Role type from
// a "use client" component would pull drizzle-orm into the browser bundle. The
// dependency therefore points this way: schema -> roles, never the reverse.
//
// v1 re-declared `type Role` on the client and hard-coded the strings in seven
// more places, so a fourth role could not be added without hunting them down.

/** The five least-privilege roles. Order is display order. */
export const ROLES = [
  "admin",
  "moderator",
  "org-editor",
  "member-business",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

/** Roles that belong to an organization. The rest are Chamber staff and carry
 *  org_id = null (enforced by the users_org_binding check constraint). */
export const ORG_ROLES = ["org-editor", "member-business"] as const;

export const ORG_KINDS = ["business", "nonprofit"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export function isOrgRole(role: Role): boolean {
  return (ORG_ROLES as readonly string[]).includes(role);
}

/** Human-facing names. The stored value never changes; this is display only. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Chamber admin",
  moderator: "Moderator",
  "org-editor": "Nonprofit editor",
  "member-business": "Business member",
  viewer: "Reporting viewer",
};

/** One line explaining what each role may do — shown next to the role picker
 *  so an admin granting access can see the blast radius. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything: accounts, invites, backups, and all content.",
  moderator: "Reviews submitted content. No access to accounts or backups.",
  "org-editor": "Edits their nonprofit's profile, events, and volunteer needs.",
  "member-business": "Edits their business's listing and events.",
  viewer: "Read-only access for reporting and grant work.",
};

/** Badge tint per role. Keys are the existing badgeTones in components/ui.tsx
 *  (navy | teal | coral | green | sand) — E06 adds no palette tokens. */
export const ROLE_TONES = {
  admin: "navy",
  moderator: "coral",
  "org-editor": "green",
  "member-business": "teal",
  viewer: "sand",
} as const satisfies Record<Role, "navy" | "teal" | "coral" | "green" | "sand">;
