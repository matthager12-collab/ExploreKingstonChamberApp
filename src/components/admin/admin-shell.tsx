import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { adminSectionsFor } from "@/lib/admin-nav";
import { AppRail, type RailSection } from "@/components/shell/app-rail";

/* THE WAY OUT.
 *
 * /admin used to render inside the (site) group, so the public header sat above
 * every admin page and "back to the site" was always one click away. Moving the
 * console into its own (admin) group took that header away and replaced it with
 * nothing: every link in the rail pointed at /admin/*, so once you were in the
 * console there was no route back to the public site OR across to the portal.
 * A console is a room, and a room needs a door.
 *
 * These live HERE rather than in ADMIN_NAV on purpose. That manifest is the
 * source of truth for admin SURFACES and feeds two consumers — this rail and
 * the portal dashboard's card list — and admin-nav.test.ts asserts the rail
 * covers exactly those surfaces and nothing else. An exit is chrome, not a
 * surface: putting it in the manifest would both add a bogus "Explore Kingston"
 * card to the dashboard and cost a genuinely useful tripwire.
 *
 * leavesShell adds the screen-reader "(leaves this console)" note, so the jump
 * is announced rather than discovered on arrival.
 */
export const ADMIN_EXITS: RailSection[] = [
  {
    id: "exit-site",
    label: "Explore Kingston",
    icon: "site",
    leavesShell: true,
    items: [{ href: "/", label: "Public site" }],
  },
  {
    id: "exit-portal",
    label: "Member portal",
    icon: "leave",
    leavesShell: true,
    items: [{ href: "/portal", label: "Member portal" }],
  },
];

// The shared chrome for every /admin page.
//
// WAS a slim sticky header with a horizontally-scrolling strip of nav chips.
// Nineteen chips had outgrown the bar: the last four were off-screen until you
// dragged sideways, and there was no grouping to tell you where anything lived.
// It is now the same N5 rail the portal uses — seven sections, each holding two
// to four pages.
//
// Still a SERVER component, and that is the load-bearing part: adminSectionsFor()
// calls the can() seam here during the layout render, and only plain
// {id, label, icon, items} strings cross to the client. No capability logic and
// no SessionUser reaches the browser bundle.
//
// It renders ONLY navigation. Each page keeps its own heading, so titles are
// never doubled.
export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return (
    <AppRail
      surface="admin"
      brand={{ full: "Chamber admin", short: "CA" }}
      brandHref="/admin"
      sections={[...adminSectionsFor(user), ...ADMIN_EXITS]}
      footer={{ primary: user.name, secondary: ROLE_LABELS[user.role] }}
    >
      {children}
    </AppRail>
  );
}
