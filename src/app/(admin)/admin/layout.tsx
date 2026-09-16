// Auth gate for EVERYTHING under /admin (insights, hunts, accounts, …).
//
// Rules:
//  - role "admin" → allowed.
//  - anyone else, INCLUDING an unauthenticated visitor on a fresh install →
//    redirect to /portal.
//
// E06 removed the "pre-setup grace" that used to leave /admin world-readable
// (behind an amber banner) whenever zero users existed. It was the audit's
// highest-risk finding, because the two conditions that trigger it are the
// same event: anything that empties the user store — a bad restore, a failed
// migration, a dropped table — simultaneously re-arms /portal/setup AND throws
// /admin open to the public, at exactly the moment the operator is distracted
// by the outage.
//
// Bootstrap still works without it: /portal redirects to /portal/setup when no
// users exist, so the first-admin flow is reachable from the front door and
// /admin is never the entry point. (/portal/setup is itself gated by
// SETUP_TOKEN — see src/app/api/auth/setup/route.ts.)
//
// This layout is defense in depth, not the only gate: src/proxy.ts turns away
// unauthenticated requests at the request boundary, and every /api/admin route
// re-checks the role itself, because route handlers bypass layouts entirely.

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  // Defense in depth: the shell is only reachable by an admin here, but the proxy
  // and every /api/admin route still gate independently (route handlers bypass
  // layouts). Only the admin branch gets the shell; everyone else is redirected,
  // exactly as before — no world-readable /admin is reintroduced.
  if (user?.role === "admin") return <AdminShell user={user}>{children}</AdminShell>;
  redirect("/portal");
}
