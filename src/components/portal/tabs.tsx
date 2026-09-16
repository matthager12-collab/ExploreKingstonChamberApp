"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* Tabs for a single record inside the portal shell.
 *
 * Not a competing navigation level — the rail says which SECTION you are in,
 * the tabs say which part of THIS record you are editing. Reach for them when
 * a record has more than about three groups of fields; below that, stacked
 * sections read better and cost no clicks.
 *
 * Real links, not local state: each pane is a URL, so the Chamber can email a
 * member a link straight to their hours, and the back button behaves.
 *
 * role="tablist" is deliberately absent. ARIA tabs promise arrow-key traversal
 * and a single tab stop, which is the wrong model for links that navigate.
 * This is a nav, so it is marked up as one.
 *
 * The tradeoff that ships with tabs: their contents are invisible until
 * clicked. Never put anything urgent behind one. */

export function Tabs({
  label = "Sections",
  items,
}: {
  label?: string;
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="border-b border-border">
      <ul className="flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const isActive = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-block min-h-11 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
