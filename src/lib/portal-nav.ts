// The ONE source of truth for the portal's navigation.
//
// Deliberately the same shape and the same discipline as src/lib/admin-nav.ts:
// one manifest, rendered by the shell, with a test that FAILS THE BUILD if an
// href does not resolve to a real page (tests/unit/portal-nav.test.ts). Adding
// a portal surface is a one-line change here — never an edit to a layout.
//
// Two levels, and only two: a rail SECTION, and the pages inside it. A third
// level is the signal that a section should split, or that the depth belongs in
// tabs on a record's own page. The pre-shell portal had no levels at all — it
// was a grid of link cards, so every click left the page and lost its context.
//
// Visibility is keyed to `role` rather than to the can() seam because these are
// self-service surfaces, not capabilities: "my business" is about WHICH org you
// belong to, not what actions you may perform. Admin surfaces stay behind
// adminNavFor()/can() where they already live.

import type { Role } from "@/lib/auth/roles";
import type { PortalIconName } from "@/components/portal/portal-icons";

export interface PortalNavItem {
  /** Route. MUST resolve to a real page (enforced by test). */
  href: string;
  label: string;
}

export interface PortalNavSection {
  /** Stable id — React key and active-highlight key. */
  id: string;
  /** Rail label. Also the accessible name when the rail is collapsed. */
  label: string;
  icon: PortalIconName;
  items: readonly PortalNavItem[];
  /** Roles that may see this section. Omit = every signed-in role. */
  roles?: readonly Role[];
  /** True when following it LEAVES the portal shell (currently just /admin,
   *  which has its own shell). Rendered with an "opens elsewhere" cue. */
  leavesShell?: boolean;
}

export const PORTAL_NAV: readonly PortalNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "overview",
    items: [{ href: "/portal", label: "Overview" }],
  },
  {
    id: "business",
    label: "My business",
    icon: "business",
    roles: ["member-business", "admin"],
    items: [{ href: "/portal/business", label: "Listing & events" }],
  },
  {
    id: "nonprofit",
    label: "My organization",
    icon: "nonprofit",
    roles: ["org-editor", "admin"],
    items: [{ href: "/portal/nonprofit", label: "Profile & shifts" }],
  },
  {
    id: "syndicate",
    label: "Syndicate",
    icon: "syndicate",
    items: [{ href: "/portal/syndicate", label: "Feeds & checklists" }],
  },
  {
    id: "account",
    label: "My account",
    icon: "account",
    items: [{ href: "/portal/account", label: "Name, email, password" }],
  },
  {
    // Admin keeps its OWN shell (src/components/admin/admin-shell.tsx) and its
    // own manifest. This entry only preserves the entry point the old portal
    // dashboard provided — merging the two shells is a separate piece of work,
    // deliberately out of scope here.
    id: "admin",
    label: "Chamber admin",
    icon: "admin",
    roles: ["admin"],
    leavesShell: true,
    items: [{ href: "/admin", label: "Admin surfaces" }],
  },
];

/** The sections a given role may see, in display order. */
export function portalNavFor(role: Role): PortalNavSection[] {
  return PORTAL_NAV.filter((s) => !s.roles || s.roles.includes(role));
}

/** The section owning a pathname. Longest matching item href wins, so
 *  /portal/business/42 resolves to "My business" rather than to "Overview",
 *  whose /portal prefix would otherwise match everything. */
export function portalSectionFor(
  pathname: string,
  role: Role,
): PortalNavSection | undefined {
  let best: { section: PortalNavSection; length: number } | undefined;
  for (const section of portalNavFor(role)) {
    for (const item of section.items) {
      const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && (!best || item.href.length > best.length)) {
        best = { section, length: item.href.length };
      }
    }
  }
  return best?.section;
}
