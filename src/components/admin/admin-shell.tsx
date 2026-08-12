import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { adminSectionsFor } from "@/lib/admin-nav";
import { AppRail } from "@/components/shell/app-rail";

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
      sections={adminSectionsFor(user)}
      footer={{ primary: user.name, secondary: ROLE_LABELS[user.role] }}
    >
      {children}
    </AppRail>
  );
}
