// Claim-invite role derivation (E17 claims console).
//
// The console DERIVES the invite role from the store a listing lives in — it
// is never operator-typed, for the same reason mintInvite derives the org
// kind from the role: an input that cannot be wrong beats an input that is
// checked. Charities onboard as nonprofit editors; every business-shaped
// domain (restaurants, lodging, and the E17 directory) onboards as a
// business member.
//
// This module deliberately imports only the role TYPE from @/lib/auth/roles
// (which itself imports nothing), so the client claims manager can read the
// mapping without dragging server code into the browser bundle. The
// server-side assembly helper (console-data.ts) re-exports it for tests.

import type { Role } from "@/lib/auth/roles";

/** The four claimable listing domains, in console display order. */
export const CLAIM_STORES = [
  "restaurants",
  "lodging",
  "charities",
  "directory",
] as const;
export type ClaimStore = (typeof CLAIM_STORES)[number];

/** store → invite role. Exactly this mapping — a unit test pins it. */
export const CLAIM_INVITE_ROLE_BY_STORE = {
  restaurants: "member-business",
  lodging: "member-business",
  charities: "org-editor",
  directory: "member-business",
} as const satisfies Record<ClaimStore, Extract<Role, "member-business" | "org-editor">>;

/** Reader-facing label per store, for the console's table and filters. */
export const CLAIM_STORE_LABELS: Record<ClaimStore, string> = {
  restaurants: "Restaurant",
  lodging: "Lodging",
  charities: "Nonprofit",
  directory: "Directory",
};

export function isClaimStore(value: string): value is ClaimStore {
  return (CLAIM_STORES as readonly string[]).includes(value);
}
