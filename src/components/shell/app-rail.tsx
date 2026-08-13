"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { IconChevron, IconClose, IconMenu, NAV_ICONS } from "./icons";
import type { NavIconName } from "@/lib/nav-icons";

/* THE APP RAIL — one component, both consoles (pattern N5).
 *
 * The portal and the admin console are the same navigation problem: a set of
 * sections, each holding a page or three, for someone who works in the tool
 * daily. Two copies would be two places to fix the next bug in it, so this is
 * parameterised instead — by brand, by surface, and by the sections it is
 * handed.
 *
 * Only plain data reaches this file. Both callers filter by role on the SERVER
 * and pass {id, label, icon, items} strings, so no capability logic and no
 * SessionUser crosses the boundary. That split is the one AdminShell already
 * used and it is preserved.
 *
 * THE RULES THAT SHIP WITH THIS COMPONENT:
 *   - the rail defaults to EXPANDED, and labels are never more than one click
 *     away. Collapsed, every link keeps aria-label + title, so a glyph is never
 *     a control's only name. An icon is a memory test; the label is the answer.
 *   - the section panel appears ONLY when a section holds more than one page.
 *     A navigation level that offers no choice is not navigation.
 */

export type RailSection = {
  id: string;
  label: string;
  icon: NavIconName;
  items: { href: string; label: string }[];
  /** True when following it leaves this console for another. */
  leavesShell?: boolean;
};

/* Rail width lives in a data attribute on <html> so CSS does the resizing and
 * the pre-paint bootstrap in the root layout can restore it before first paint.
 * React only subscribes; it never owns a second copy of this state.
 *
 * ONE key for both consoles on purpose — "do I want a wide rail" is a fact
 * about the person, not about which tool they happen to be in. */
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
    localStorage.setItem("ui:rail", value);
  } catch {
    // Safari private mode. The setting still applies for this session.
  }
  listeners.forEach((l) => l());
}

export function AppRail({
  surface,
  brand,
  brandHref,
  sections,
  footer,
  children,
}: {
  /** Drives the scoped token overrides in globals.css. */
  surface: "portal" | "admin";
  /** Full label when expanded; short one when collapsed. */
  brand: { full: string; short: string };
  brandHref?: string;
  sections: RailSection[];
  /** Who you are signed in as — rendered at the foot of the rail. */
  footer?: { primary: string; secondary?: string };
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const rail = useSyncExternalStore(subscribe, railSnapshot, () => "expanded");
  const expanded = rail !== "collapsed";
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* THE EXITS SINK TO THE FOOT OF THE RAIL.
   *
   * Both consoles listed their exits last but INLINE, so "Explore Kingston" sat
   * flush against the last real section and read as one more place to work.
   * They are not: they are the door, and a door belongs at the edge of a room,
   * not among the furniture. Pinned to the bottom with a rule above them, the
   * scanning order becomes "everything I do here" and then, separately,
   * "everywhere else I could be".
   *
   * The split keys off `leavesShell`, which already means exactly this — so no
   * caller changes and BOTH rails get the treatment from one rule, which is the
   * promise at the top of this file. */
  const primary = sections.filter((s) => !s.leavesShell);
  const bottom = sections.filter((s) => s.leavesShell);

  // Longest matching href wins, so /portal/business/42 highlights "My business"
  // rather than Overview, whose /portal prefix matches everything. Exits are
  // excluded: their hrefs ("/" above all) live OUTSIDE this console, so they can
  // only ever be a false positive here.
  let active = primary[0];
  let bestLength = -1;
  for (const section of primary) {
    for (const item of section.items) {
      const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && item.href.length > bestLength) {
        bestLength = item.href.length;
        active = section;
      }
    }
  }

  const showPanel = (active?.items.length ?? 0) > 1;

  // One renderer for both lists — the exits differ in WHERE they sit, not in how
  // a rail link behaves, so collapsed labelling and the drawer-close stay shared.
  const renderSection = (section: RailSection) => {
    const Icon = NAV_ICONS[section.icon];
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
              <span className="sr-only"> (leaves this console)</span>
            )}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div data-surface={surface} className="flex min-h-dvh bg-surface">
      {drawerOpen && (
        <div
          className="fixed inset-0 z-20 bg-ink/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sticky and exactly one viewport tall on desktop. Static would let the
          nav column stretch to the full document height, pinning the collapse
          control to the bottom of the PAGE — unreachable on any long screen. */}
      <div
        className={`fixed inset-y-0 left-0 z-30 flex transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0 md:self-start ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav
          aria-label="Sections"
          className="app-rail flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-sunken p-2"
        >
          {/* Collapse sits at the TOP. Bottom-left is where Next's dev
              indicator lives, and it covered the control completely — the
              button was unclickable for a whole local session while production
              would have been fine. */}
          <div className="mb-2 flex min-h-11 items-center gap-1">
            {expanded && (
              // text-base, not text-lg: the label shares 13rem with the
              // collapse control, and "Chamber admin" truncated to
              // "Chamber ad…" at the larger size. A console's name is a label,
              // not a headline — shrinking it beats abbreviating it.
              <Link
                href={brandHref ?? primary[0]?.items[0]?.href ?? "#"}
                className="min-w-0 flex-1 truncate px-2 font-display text-base font-semibold text-primary"
              >
                {brand.full}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setRail(expanded ? "collapsed" : "expanded")}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse the menu" : "Expand the menu"}
              title={expanded ? "Collapse the menu" : "Expand the menu"}
              className="hidden size-11 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-white hover:text-ink md:flex"
            >
              <IconChevron
                size={20}
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            {/* On mobile the rail is a drawer that is either open or shut, so
                that slot becomes Close. The section panel used to own this
                button and can now be absent entirely. */}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-white hover:text-ink md:hidden"
            >
              <IconClose size={20} />
              <span className="sr-only">Close menu</span>
            </button>
          </div>

          {primary.map(renderSection)}

          {/* mt-auto moved OFF the footer and onto this block, so the exits sink
              with it and stay above the signed-in line. The rail column already
              scrolls (overflow-y-auto), so on a short viewport this simply stops
              floating and the exits sit after the sections — never clipped. */}
          {(bottom.length > 0 || (expanded && footer)) && (
            <div className="mt-auto flex flex-col gap-1 pt-2">
              {bottom.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-border pt-2">
                  {bottom.map(renderSection)}
                </div>
              )}

              {expanded && footer && (
                <p className="border-t border-border px-2 pt-3 text-xs text-ink-soft">
                  Signed in as{" "}
                  <span className="font-semibold text-ink">{footer.primary}</span>
                  {footer.secondary && (
                    <>
                      <br />
                      {footer.secondary}
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </nav>

        {/* Only when the section has somewhere to go. With a single page it
            listed one link repeating the rail label immediately to its left —
            224px of width to offer no choice. */}
        {/* The heading lives INSIDE the nav. Outside it, it was page content
            belonging to no landmark, which axe reports as a "region" violation
            — and it is a real one: a screen reader jumping by landmark would
            meet the links with nothing naming them. */}
        {showPanel && (
          <div className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-white p-3">
            <nav
              aria-label={`${active?.label ?? "Section"} pages`}
              className="flex flex-col gap-1"
            >
              <span className="mb-1 px-1 font-display text-sm font-semibold text-ink">
                {active?.label}
              </span>
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
          </div>
        )}
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
