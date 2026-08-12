import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { portalNavFor } from "@/lib/portal-nav";
import { AppRail, type RailSection } from "@/components/shell/app-rail";

// The server half of the portal shell. Role filtering happens HERE, and only
// plain {id, label, icon, items} strings cross to the client — no SessionUser
// and no capability logic reaches the browser bundle.
//
// The rail itself is shared with the admin console (components/shell/app-rail):
// same navigation problem, same rules, one place to fix the next bug in it.
export function PortalShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const sections: RailSection[] = portalNavFor(user.role).map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    items: s.items.map((i) => ({ href: i.href, label: i.label })),
    leavesShell: s.leavesShell,
  }));

  return (
    <AppRail
      surface="portal"
      brand={{ full: "Kingston", short: "K" }}
      brandHref="/portal"
      sections={sections}
      footer={{ primary: user.name, secondary: ROLE_LABELS[user.role] }}
    >
      {children}
    </AppRail>
  );
}
