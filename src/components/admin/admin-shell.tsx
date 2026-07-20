import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { adminNavFor } from "@/lib/admin-nav";
import { AdminNav } from "./admin-nav";

// The shared chrome for every /admin page: a slim, sticky header bar with the
// "Chamber admin" wordmark (back to /portal) and the role-filtered section nav.
// It is a SERVER component — adminNavFor() (which calls the can() seam) runs here
// during the layout render, and only plain {id, href, navLabel} strings cross to
// the client <AdminNav>. It renders ONLY the nav; each page keeps its own
// PageHeader, so titles are never doubled.
export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const items = adminNavFor(user).map((e) => ({
    id: e.id,
    href: e.href,
    navLabel: e.navLabel,
  }));

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-sand bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex items-center justify-between gap-3 pt-2">
            <Link
              href="/portal"
              className="font-display text-sm font-semibold whitespace-nowrap text-sound-deep"
            >
              ← Chamber admin
            </Link>
            <span className="truncate text-xs text-ink-soft">{user.name}</span>
          </div>
          <AdminNav items={items} />
        </div>
      </header>
      {children}
    </div>
  );
}
