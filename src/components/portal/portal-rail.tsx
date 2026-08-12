"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  IconChevron,
  IconClose,
  IconMenu,
  PORTAL_ICONS,
  type PortalIconName,
} from "./portal-icons";

/* The interactive half of the portal shell (pattern N5).
 *
 * Only plain data reaches this file — the server has already filtered sections
 * by role, so no capability logic and no SessionUser crosses the boundary. That
 * is the same split src/components/admin/admin-shell.tsx uses.
 *
 * THE RULE THAT SHIPS WITH THIS COMPONENT: the rail defaults to EXPANDED and
 * the labels are never more than one click away. When collapsed, every link
 * carries aria-label + title, so a glyph is never the only name for a control.
 * An icon is a memory test; the label is the answer key. */

export type RailSection = {
  id: string;
  label: string;
  icon: PortalIconName;
  items: { href: string; label: string }[];
  leavesShell?: boolean;
};

/* Rail width lives in a data attribute on <html> so the CSS in globals.css can
 * do the resizing, and the inline bootstrap in the portal layout can restore it
 * before first paint. React only subscribes — it never owns a second copy of
 * this state, which is what keeps the two from drifting. */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function railSnapshot() {
  return document.documentElement.getAttribute("data-rail") ?? "expanded";
}

function setRail(value: string) {
  document.documentElement.setAttribute("data-rail", value);
  try {
    localStorage.setItem("portal:rail", value);
  } catch {
    // Safari private mode. The setting still applies for this session.
  }
  listeners.forEach((l) => l());
}

export function PortalRail({
  sections,
  userName,
  roleLabel,
  children,
}: {
  sections: RailSection[];
  userName: string;
  roleLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const rail = useSyncExternalStore(subscribe, railSnapshot, () => "expanded");
  const expanded = rail !== "collapsed";
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Longest matching href wins, so /portal/business/42 highlights "My business"
  // rather than "Overview", whose /portal prefix matches everything.
  let active = sections[0];
  let bestLength = -1;
  for (const section of sections) {
    for (const item of section.items) {
      const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && item.href.length > bestLength) {
        bestLength = item.href.length;
        active = section;
      }
    }
  }

  return (
    // data-surface="portal" is what activates the portal-scoped token overrides
    // in globals.css. Without it the portal renders with the public site's
    // ink-soft, which is 4.4993:1 on the shell fill.
    <div data-surface="portal" className="flex min-h-dvh bg-surface">
      {drawerOpen && (
        <div
          className="fixed inset-0 z-20 bg-ink/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sticky and exactly one viewport tall on desktop. Static would let the
          nav column stretch to the full document height, which pins the collapse
          control to the bottom of the PAGE — unreachable on any long screen. */}
      <div
        className={`fixed inset-y-0 left-0 z-30 flex transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0 md:self-start ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav
          aria-label="Portal sections"
          className="portal-rail flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-sunken p-2"
        >
          <span className="mb-2 truncate px-2 py-1 font-display text-lg font-semibold text-primary">
            {expanded ? "Kingston" : "K"}
          </span>

          {sections.map((section) => {
            const Icon = PORTAL_ICONS[section.icon];
            const isActive = section.id === active?.id;
            return (
              <Link
                key={section.id}
                href={section.items[0].href}
                onClick={() => setDrawerOpen(false)}
                aria-current={isActive ? "page" : undefined}
                aria-label={expanded ? undefined : section.label}
                title={expanded ? undefined : section.label}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 font-semibold transition-colors ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-ink-soft hover:bg-white hover:text-ink"
                }`}
              >
                <Icon size={22} className="shrink-0" />
                {expanded && (
                  <span className="truncate text-sm">
                    {section.label}
                    {section.leavesShell && (
                      <span className="sr-only"> (leaves the portal)</span>
                    )}
                  </span>
                )}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setRail(expanded ? "collapsed" : "expanded")}
            aria-expanded={expanded}
            className="mt-auto flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-semibold text-ink-soft hover:bg-white hover:text-ink"
          >
            <IconChevron
              size={20}
              className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {expanded ? <span className="truncate">Collapse</span> : <span className="sr-only">Expand the menu</span>}
          </button>
        </nav>

        <div className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-white p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="px-1 font-display text-sm font-semibold text-ink">
              {active?.label}
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-lg p-1 text-ink-soft hover:bg-surface-sunken md:hidden"
            >
              <IconClose size={20} />
              <span className="sr-only">Close menu</span>
            </button>
          </div>

          <nav aria-label={`${active?.label ?? "Section"} pages`} className="flex flex-col gap-1">
            {active?.items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`min-h-11 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-surface-sunken font-semibold text-ink"
                      : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <p className="mt-auto border-t border-border px-1 pt-3 text-xs text-ink-soft">
            Signed in as <span className="font-semibold text-ink">{userName}</span>
            <br />
            {roleLabel}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-white px-5 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-sunken"
          >
            <IconMenu />
            <span className="sr-only">Open menu</span>
          </button>
          <span className="font-display font-semibold text-ink">{active?.label}</span>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
