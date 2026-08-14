// Where an account belongs when it has just signed in — the ONE definition of
// "the right place" for a role.
//
// The app has two consoles, each with its own shell and its own nav manifest:
//   /admin   — the Chamber console  (src/lib/admin-nav.ts)
//   /portal  — the member portal    (src/lib/portal-nav.ts)
// Before this module every sign-in landed on /portal regardless of role, so a
// Chamber admin's first act after every login was to find the "Chamber admin"
// rail entry and click through. This closes that gap.
//
// ── Why a role table and NOT a return-URL ────────────────────────────────
// src/proxy.ts deliberately redirects unauthenticated page requests to /portal
// with no `?next=` parameter, because a caller-supplied return URL is an
// open-redirect surface. This module does not reopen that decision: the
// destination is chosen from the CLOSED set below using the role the server
// just read out of the database. Nothing the caller sent can influence it.
// That property is what lets the login response carry `redirectTo` at all.
//
// Imports NOTHING but the Role type, for the same reason roles.ts imports
// nothing: both the API routes (server) and the auth forms (client) need this,
// and pulling drizzle into the browser bundle through it would be a regression.

import type { Role } from "@/lib/auth/roles";

/** Where a signed-in account with no better answer goes. Also the value the
 *  client falls back to if a response ever arrives without `redirectTo`. */
export const LANDING_FALLBACK = "/portal";

/**
 * The role → console table.
 *
 * A role is listed here ONLY when it lands somewhere other than the member
 * portal, so the fallback stays the honest default rather than a row that has
 * to be kept in sync.
 *
 * ── Why moderator and viewer are NOT here ────────────────────────────────
 * Both are real, enforced roles (E06) whose eventual home is the Chamber
 * console — but src/app/(admin)/admin/layout.tsx gates on `role === "admin"`
 * and redirects everyone else to /portal. Landing them on /admin today would
 * bounce them straight back, a redirect round-trip that ends where they
 * started. /portal is also where their "access is set up, tools are coming"
 * callout renders, which is the honest thing to show. When the console becomes
 * role-scoped (its manifest is already keyed by capability, so it is ready),
 * add the rows here and the routing follows.
 */
const LANDING_BY_ROLE: Partial<Record<Role, string>> = {
  admin: "/admin",
};

/**
 * The single question: given a role, which console?
 *
 * Callers: the three auth routes that mint a session (login, redeem, setup).
 * Every one of them derives this from the role it just persisted — never from
 * the request body.
 *
 * NOT a caller: /api/claim/verify, which also mints a session (a business
 * owner who just proved their email while claiming a directory listing). That
 * flow ends in an IN-PAGE result rather than a navigation, because the claim
 * may still be `pending` — and dropping someone into the portal for a listing
 * the Chamber has not yet granted them is the one landing that would be
 * actively wrong. If that flow ever grows a redirect, it should come through
 * here, keyed on approval and not only on role.
 */
export function landingFor(role: Role): string {
  return LANDING_BY_ROLE[role] ?? LANDING_FALLBACK;
}

/**
 * Client-side guard for a `redirectTo` off the wire.
 *
 * The value is server-computed from the closed table above, so this can only
 * fire on a bug — but it is two lines, and it means the no-open-redirect
 * property of the sign-in flow is provable from the CLIENT alone rather than
 * resting on an argument about what the server does. Rejects anything that is
 * not a same-origin absolute path: "//evil.example" and "https://evil.example"
 * are both browser-valid destinations that start life looking harmless.
 *
 * The backslash clause is not paranoia. Browsers normalize "\" to "/" while
 * parsing the authority, so "/\evil.example" passes a naive startsWith("//")
 * check and then resolves as the protocol-relative "//evil.example" — an
 * off-site redirect through a string that reads as an absolute local path.
 */
export function safeLandingPath(value: unknown): string {
  if (typeof value !== "string") return LANDING_FALLBACK;
  if (!value.startsWith("/") || value.startsWith("//")) return LANDING_FALLBACK;
  if (value.includes("\\")) return LANDING_FALLBACK;
  return value;
}
