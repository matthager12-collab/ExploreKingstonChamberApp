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
import type { NavIconName } from "@/lib/nav-icons";

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
  /** Which rail section this surface lives under (ADMIN_SECTIONS below).
   *  ADDITIVE: the dead-link test and adminNavFor() are untouched by it. */
  section: AdminSectionId;
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
    section: "insights",
  },
  {
    id: "feedback",
    href: "/admin/feedback",
    title: "Page feedback",
    navLabel: "Feedback",
    blurb: "Star ratings and comments visitors sent, and which page they were on.",
    // view-reports, not manage-site: reading what visitors said is a reporting
    // activity, and keying it this way means a future board-designee or viewer
    // role sees it alongside Insights and History without a change here.
    capability: "view-reports",
    section: "insights",
  },
  {
    id: "content",
    href: "/admin/content",
    title: "Site content",
    navLabel: "Content",
    blurb: "Edit page text and show or hide entire pages.",
    capability: "manage-site",
    section: "listings",
  },
  {
    id: "media",
    href: "/admin/media",
    title: "Photos",
    navLabel: "Photos",
    blurb: "Upload photos once, then use them on the home page, kiosk, and listings.",
    capability: "manage-site",
    section: "listings",
  },
  {
    id: "listings",
    href: "/admin/listings",
    title: "Restaurants, lodging & webcams",
    navLabel: "Listings",
    blurb:
      "Edit Eat & Drink vendors — descriptions, show/hide, add new — plus lodging and webcams.",
    capability: "manage-site",
    section: "listings",
  },
  {
    id: "itineraries",
    href: "/admin/itineraries",
    title: "Itineraries",
    navLabel: "Itineraries",
    blurb: "Build and edit the ready-made day plans.",
    capability: "manage-site",
    section: "experiences",
  },
  {
    id: "hunts",
    href: "/admin/hunts",
    title: "Scavenger hunts",
    navLabel: "Hunts",
    blurb: "Build hunts, reference photos, review submissions.",
    capability: "manage-site",
    section: "experiences",
  },
  {
    id: "ferry",
    href: "/admin/ferry-info",
    title: "Ferry settings",
    navLabel: "Ferry",
    blurb:
      "Busyness prediction on/off + accuracy, boarding-pass status, and payment/cash facts.",
    capability: "manage-site",
    section: "experiences",
  },
  {
    id: "map",
    href: "/admin/map",
    title: "Parking map editor",
    navLabel: "Parking map",
    blurb: "Drag pins and lot shapes to match reality; mark them field-verified.",
    capability: "manage-site",
    section: "maps",
  },
  {
    id: "maps",
    href: "/admin/maps",
    title: "Map builder",
    navLabel: "Map builder",
    blurb: "Create map views and drop markers, trails, and areas onto them.",
    capability: "manage-site",
    section: "maps",
  },
  {
    id: "accounts",
    href: "/admin/accounts",
    title: "Accounts & invites",
    navLabel: "Accounts",
    blurb: "Invite businesses and nonprofits, manage who edits what.",
    capability: "manage-accounts",
    section: "members",
  },
  {
    id: "claims",
    href: "/admin/claims",
    title: "Claims console",
    navLabel: "Claims",
    blurb: "See which listings are claimed, and invite the owners who haven't.",
    capability: "manage-accounts",
    section: "members",
  },
  {
    id: "worklist",
    href: "/admin/worklist",
    title: "Worklist / moderation",
    navLabel: "Worklist",
    blurb:
      "Review member submissions, visitor reports, and content due for a re-check.",
    capability: "moderate",
    section: "members",
  },
  {
    id: "events",
    href: "/admin/events",
    title: "Events",
    navLabel: "Events",
    blurb:
      "Every event on the town calendar, whoever created it — including repeating series.",
    capability: "manage-site",
    section: "events",
  },
  {
    id: "events-sources",
    href: "/admin/events-sources",
    title: "Events sources",
    // "Events" is the workbench above; this one is the plumbing behind it.
    navLabel: "Event feeds",
    blurb:
      "Which community calendars feed the unified events list, duplicate review, and the go-live switch.",
    capability: "manage-site",
    section: "events",
  },
  {
    id: "kiosk",
    href: "/admin/kiosk",
    title: "Ferry-dock kiosk",
    navLabel: "Kiosk",
    blurb: "Turn the dock touchscreen on or off, pick its screens, push an update now.",
    capability: "manage-site",
    section: "experiences",
  },
  {
    id: "import-qwick",
    href: "/admin/import/qwick",
    title: "Listings import (Qwick)",
    navLabel: "Import",
    blurb:
      "Preview and apply a saved Qwick kiosk export — everything lands as invisible drafts.",
    capability: "manage-site",
    section: "members",
  },
  {
    id: "audit",
    href: "/admin/audit",
    title: "Change history",
    navLabel: "History",
    blurb: "Every edit, who made it, and one-tap restore — nothing is ever lost.",
    capability: "view-reports",
    section: "system",
  },
  {
    id: "ops",
    href: "/admin/ops",
    title: "Ops & status",
    navLabel: "Ops",
    blurb: "System health, backups, scheduled jobs, and geo-IP status in one place.",
    capability: "manage-site",
    section: "system",
  },
];

/** The admin surfaces `user` is allowed to see, in nav order. */
export function adminNavFor(user: AuthSubject): AdminNavEntry[] {
  return ADMIN_NAV.filter((entry) => can(user, entry.capability));
}


/* ---------------------------------------------------------------------------
 * SECTIONS (the N5 rail)
 *
 * Nineteen surfaces is too many for a flat strip: the chip bar had outgrown its
 * width and scrolled horizontally, so the last four entries were invisible
 * until you dragged. Grouped, they are seven sections of two to four pages —
 * which is also what finally earns the section panel its place, since a section
 * holding one page renders no panel at all.
 *
 * Grouping is by the ADMINISTRATOR'S JOB, not by the data model: "how is the
 * site doing", "who belongs", "what's in the directory", and so on. That is why
 * ferry-info sits under Experiences (a thing visitors see) rather than under
 * System (a thing operators tend).
 * ------------------------------------------------------------------------- */

export const ADMIN_SECTIONS = [
  { id: "insights", label: "Insights", icon: "insights" },
  { id: "members", label: "Members", icon: "members" },
  { id: "listings", label: "Listings", icon: "listings" },
  { id: "events", label: "Events", icon: "events" },
  { id: "experiences", label: "Experiences", icon: "experiences" },
  { id: "maps", label: "Maps", icon: "maps" },
  { id: "system", label: "System", icon: "system" },
] as const satisfies readonly { id: string; label: string; icon: NavIconName }[];

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];

export interface AdminRailSection {
  id: AdminSectionId;
  label: string;
  icon: NavIconName;
  items: { href: string; label: string }[];
}

/**
 * The manifest, grouped into rail sections and filtered by capability — the
 * shape the shared AppRail consumes.
 *
 * Sections with no visible entries are dropped entirely rather than rendered
 * empty, so a future role-scoped shell self-prunes with no change here.
 */
export function adminSectionsFor(user: AuthSubject): AdminRailSection[] {
  const visible = adminNavFor(user);
  return ADMIN_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    icon: section.icon as NavIconName,
    items: visible
      .filter((e) => e.section === section.id)
      .map((e) => ({ href: e.href, label: e.navLabel })),
  })).filter((s) => s.items.length > 0);
}
