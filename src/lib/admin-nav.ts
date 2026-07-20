// The ONE source of truth for the /admin surface list (E10 admin shell).
//
// Both the shared admin chrome (src/components/admin/admin-shell.tsx) and the
// portal dashboard (src/app/portal/page.tsx) render from this array, so adding an
// admin surface is a one-line change here — and a dead nav link is a FAILING
// BUILD: tests/unit/admin-nav.test.ts asserts every href resolves to a real
// src/app/<href>/page.tsx. That tripwire is the whole point of the manifest.
//
// `capability` keys into the E06 can() seam (src/lib/auth/authz.ts). adminNavFor()
// returns only the entries a given user may see. The /admin layout is admin-only
// today and admin passes every action, so the filter is a no-op for the only role
// that currently reaches the shell — but keying each surface by its real action
// means a future role-scoped shell (a viewer or the board designee, a moderator)
// self-filters with no change to this file. Import can() from the pure authz
// module (no next/headers) so this manifest stays usable from the client nav and
// from vitest alike.
import { can, type Action, type AuthSubject } from "@/lib/auth/authz";

export interface AdminNavEntry {
  /** Stable id — the React key and the active-highlight key. */
  id: string;
  /** Route. MUST resolve to src/app/<href>/page.tsx (enforced by test). */
  href: string;
  /** Full title (portal card heading and page title). */
  title: string;
  /** Short label for the horizontally-scrolling nav chips (phone-first). */
  navLabel: string;
  /** One-line description (portal card body). Verbatim from the old portal. */
  blurb: string;
  /** The can() action that gates visibility in a role-scoped shell. */
  capability: Action;
}

// Order is the nav/portal display order: the insights dashboard (which lives at
// the bare /admin) first, then the content surfaces, then accounts, moderation,
// history, and finally Ops & status. Titles + blurbs are VERBATIM from the
// pre-E10 portal admin-cards block (do not reword — the em-dashes and "&" matter);
// only /admin/ops is new copy.
export const ADMIN_NAV: readonly AdminNavEntry[] = [
  {
    id: "insights",
    href: "/admin",
    title: "Visitor insights",
    navLabel: "Insights",
    blurb: "LTAC-ready analytics: origins, movement, top pages, outbound taps.",
    capability: "view-reports",
  },
  {
    id: "content",
    href: "/admin/content",
    title: "Site content",
    navLabel: "Content",
    blurb: "Edit page text and show or hide entire pages.",
    capability: "manage-site",
  },
  {
    id: "listings",
    href: "/admin/listings",
    title: "Restaurants, lodging & webcams",
    navLabel: "Listings",
    blurb:
      "Edit Eat & Drink vendors — descriptions, show/hide, add new — plus lodging and webcams.",
    capability: "manage-site",
  },
  {
    id: "itineraries",
    href: "/admin/itineraries",
    title: "Itineraries",
    navLabel: "Itineraries",
    blurb: "Build and edit the ready-made day plans.",
    capability: "manage-site",
  },
  {
    id: "hunts",
    href: "/admin/hunts",
    title: "Scavenger hunts",
    navLabel: "Hunts",
    blurb: "Build hunts, reference photos, review submissions.",
    capability: "manage-site",
  },
  {
    id: "ferry",
    href: "/admin/ferry-info",
    title: "Ferry settings",
    navLabel: "Ferry",
    blurb:
      "Busyness prediction on/off + accuracy, boarding-pass status, and payment/cash facts.",
    capability: "manage-site",
  },
  {
    id: "map",
    href: "/admin/map",
    title: "Parking map editor",
    navLabel: "Parking map",
    blurb: "Drag pins and lot shapes to match reality; mark them field-verified.",
    capability: "manage-site",
  },
  {
    id: "maps",
    href: "/admin/maps",
    title: "Map builder",
    navLabel: "Map builder",
    blurb: "Create map views and drop markers, trails, and areas onto them.",
    capability: "manage-site",
  },
  {
    id: "accounts",
    href: "/admin/accounts",
    title: "Accounts & invites",
    navLabel: "Accounts",
    blurb: "Invite businesses and nonprofits, manage who edits what.",
    capability: "manage-accounts",
  },
  {
    id: "worklist",
    href: "/admin/worklist",
    title: "Worklist / moderation",
    navLabel: "Worklist",
    blurb:
      "Review member submissions, visitor reports, and content due for a re-check.",
    capability: "moderate",
  },
  {
    id: "audit",
    href: "/admin/audit",
    title: "Change history",
    navLabel: "History",
    blurb: "Every edit, who made it, and one-tap restore — nothing is ever lost.",
    capability: "view-reports",
  },
  {
    id: "ops",
    href: "/admin/ops",
    title: "Ops & status",
    navLabel: "Ops",
    blurb: "System health, backups, scheduled jobs, and geo-IP status in one place.",
    capability: "manage-site",
  },
];

/** The admin surfaces `user` is allowed to see, in nav order. */
export function adminNavFor(user: AuthSubject): AdminNavEntry[] {
  return ADMIN_NAV.filter((entry) => can(user, entry.capability));
}
