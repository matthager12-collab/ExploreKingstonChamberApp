import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { portalNavFor } from "@/lib/portal-nav";
import { PortalRail, type RailSection } from "./portal-rail";

// The server half of the portal shell, mirroring AdminShell: role filtering
// happens HERE, and only plain {id, label, icon, items} strings cross to the
// client. No SessionUser and no capability logic reaches the browser bundle.
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
    <PortalRail
      sections={sections}
      userName={user.name}
      roleLabel={ROLE_LABELS[user.role]}
    >
      {children}
    </PortalRail>
  );
}
