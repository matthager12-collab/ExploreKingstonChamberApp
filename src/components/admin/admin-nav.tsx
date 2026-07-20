"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The client half of the admin shell: the only reason this is a client component
// is usePathname() for the active-page highlight. It receives already-filtered,
// already-serializable items (plain strings) from the server AdminShell — it does
// NOT import the manifest or the auth seam, so none of that reaches the client
// bundle. Phone-first: the chips scroll horizontally on a narrow screen and every
// tap target clears 44px (min-h-11).

export interface AdminNavItem {
  id: string;
  href: string;
  navLabel: string;
}

function isActive(pathname: string, href: string): boolean {
  // The insights dashboard lives at the bare /admin, which is a prefix of every
  // other admin route — so it only lights up on an exact match; the rest also
  // match their own nested pages (e.g. /admin/listings?store=lodging).
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname() ?? "";
  return (
    <nav
      data-testid="admin-nav"
      aria-label="Admin sections"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap transition ${
              active
                ? "bg-sound text-white"
                : "text-ink-soft hover:bg-sand hover:text-ink"
            }`}
          >
            {item.navLabel}
          </Link>
        );
      })}
    </nav>
  );
}
