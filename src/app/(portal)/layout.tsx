import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/auth";
import { SiteChrome } from "@/components/site-chrome";
import { PortalShell } from "@/components/portal/portal-shell";

// Layout for the SIGNED-IN portal. Same move E22 made for (kiosk): a route
// group adds a layout level without adding a path segment, so
// src/app/(portal)/portal/account/page.tsx still serves /portal/account and no
// URL changes. It exists because a descendant layout can never REMOVE what an
// ancestor renders — the shell and the site's nav/footer cannot coexist, so the
// portal had to move out from under SiteChrome rather than hide it.
//
// What deliberately did NOT move: /portal/join and /portal/setup. Both are
// reached with no session (an emailed invite code; first-run bootstrap), so
// they keep the site chrome and its way back to the rest of the site.
//
// getSessionUser() reads cookies, so this layout is dynamic — and that is
// exactly why it lives in its own group. In the ROOT layout the same call would
// opt every public page out of static rendering (see the note in
// src/app/layout.tsx and docs/KIOSK.md §2).

// The rail's pre-paint restore lives in the ROOT layout's existing bootstrap
// script, not here. A <script> nested in this layout is part of React's tree:
// Next warns it will not run on client navigation, and React reports the
// <html> attribute it sets as a hydration mismatch. See src/app/layout.tsx.

export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();

  // Signed out, /portal renders its own login form. Give it the site chrome so
  // it is not a dead end — without it there is no nav and no way back.
  if (!user) return <SiteChrome>{children}</SiteChrome>;

  return <PortalShell user={user}>{children}</PortalShell>;
}
