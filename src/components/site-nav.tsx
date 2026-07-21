"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SimpleModeToggle } from "@/components/simple-mode-toggle";

// E14: both "More" surfaces are DISCLOSURES, not dialogs — no focus trap, no
// `role="menu"`. What they owe the keyboard is Escape-to-close with focus
// returned to the trigger, close-on-outside-click, and Tab reaching every
// item. The ids below back `aria-controls` on the two triggers.
const MORE_MENU_ID = "site-nav-more-menu";
const MORE_SHEET_ID = "site-nav-more-sheet";

const primaryLinks = [
  { href: "/ferry", label: "Ferry" },
  { href: "/eat", label: "Eat & Drink" },
  { href: "/events", label: "Events" },
  { href: "/itineraries", label: "Itineraries" },
  { href: "/stay", label: "Stay" },
];

const moreLinks = [
  { href: "/map", label: "Map" },
  { href: "/webcams", label: "Webcams" },
  { href: "/parking", label: "Parking" },
  { href: "/hunt", label: "Scavenger Hunt" },
  { href: "/give", label: "Give Back" },
  { href: "/about", label: "About" },
  { href: "/portal", label: "Chamber Portal" },
];

export function SiteNav({ hiddenPaths = [] }: { hiddenPaths?: string[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const moreWrapRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  // Only pull focus back to the sheet trigger on a real close — never on the
  // first render, which would steal focus from wherever the page put it.
  const sheetWasOpen = useRef(false);

  // Desktop dropdown. The previous implementation closed on `onBlur` behind a
  // 150 ms timer, which raced the click it was meant to allow and hid the menu
  // the moment a keyboard user tabbed into it. Escape + outside-click instead.
  // (E14 AC 11 greps this file for that timer API — keep it out, comments too.)
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: Event) => {
      if (!moreWrapRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  // Mobile sheet: Escape closes it, and so does a tap outside it. On a phone
  // the outside tap IS the primary dismissal gesture, so the sheet needs the
  // same handler the desktop menu has. The trigger is excluded from "outside"
  // or this close and the toggle's own onClick cancel each other out.
  useEffect(() => {
    if (!sheetOpen) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (sheetRef.current?.contains(target)) return;
      if (sheetTriggerRef.current?.contains(target)) return;
      setSheetOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sheetOpen]);

  // Focus follows the sheet: into its first link on open, back to the toggle
  // on close, so a keyboard user is never dropped on <body>.
  useEffect(() => {
    if (sheetOpen) {
      sheetRef.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
    } else if (sheetWasOpen.current) {
      sheetTriggerRef.current?.focus();
    }
    sheetWasOpen.current = sheetOpen;
  }, [sheetOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Admin-hidden pages drop out of every menu (home is never hideable).
  const visible = (href: string) => !hiddenPaths.includes(href);
  const primary = primaryLinks.filter((l) => visible(l.href));
  const more = moreLinks.filter((l) => visible(l.href));
  const bottomBarLinks = [
    { href: "/", label: "Home", icon: "⌂" },
    { href: "/ferry", label: "Ferry", icon: "⛴" },
    { href: "/eat", label: "Eat", icon: "🍽" },
    { href: "/events", label: "Events", icon: "📅" },
  ].filter((l) => visible(l.href));

  return (
    <>
      {/* Top header. print:hidden (E14): site chrome is noise on paper, and the
          hiding is done here rather than with a global `header{display:none}`
          rule, which would also blank every PageHeader. */}
      <header className="sticky top-0 z-40 border-b border-sand bg-white/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setSheetOpen(false)}>
            {/* Official Explore Kingston logo — black brush-script wordmark + #1E96C0 sailboat */}
            {/* NO `sizes` here, deliberately — it looks like a bug and is not.
                Without it Next derives the srcset from the width prop and emits
                `w=828 1x, w=1920 2x`, which reads as "1920px asset for a ~122px
                logo". But the source PNG is only 751px wide and Next NEVER
                upscales: every w>=828 returns that original, optimized to 8962 B.
                Measured alternatives, displayed at 122 CSS px on a DPR-3 phone
                (366 device px), all lose:
                  256px -> 5454 B but visibly soft (1.4x upscale of brush script)
                  384px -> 9442 B — MORE than the original, because downscaling
                           this sharp-edged logo adds resampling detail that WebP
                           encodes worse than the clean original
                  751px -> 8962 B and crisp  <-- what we ship
                So the status quo is the best point on the curve. Adding `sizes`
                makes the browser pick 256px: saves ~3 KB and softens the brand
                mark on every page. Don't. (E15 perf follow-up, measured.) */}
            <Image
              src="/brand/logo-explore-kingston-primary.png"
              alt="Explore Kingston"
              width={751}
              height={297}
              loading="eager"
              className="h-12 w-auto sm:h-14"
            />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {primary.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`font-nav rounded-lg px-3 py-2 text-[0.8125rem] font-semibold tracking-wide uppercase transition-colors ${
                  isActive(l.href)
                    ? "bg-sound text-white"
                    : "text-ink hover:bg-seaglass/40 hover:text-sound"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="relative" ref={moreWrapRef}>
              <button
                type="button"
                ref={moreTriggerRef}
                onClick={() => setMoreOpen((v) => !v)}
                className={`font-nav rounded-lg px-3 py-2 text-[0.8125rem] font-semibold tracking-wide uppercase transition-colors ${
                  more.some((l) => isActive(l.href))
                    ? "bg-sound text-white"
                    : "text-ink hover:bg-seaglass/40 hover:text-sound"
                }`}
                aria-expanded={moreOpen}
                aria-controls={MORE_MENU_ID}
              >
                More <span aria-hidden="true">▾</span>
              </button>
              {moreOpen && (
                <div
                  id={MORE_MENU_ID}
                  className="absolute right-0 mt-1 w-48 rounded-xl border border-sand bg-white py-2 shadow-lg"
                >
                  {more.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      aria-current={isActive(l.href) ? "page" : undefined}
                      className="block px-4 py-2 text-sm text-ink hover:bg-seaglass/30 hover:text-sound"
                      onClick={() => setMoreOpen(false)}
                    >
                      {l.label}
                    </Link>
                  ))}
                  {/* E14: the "Easy read" switch lives in the desktop nav's More
                      disclosure rather than the top bar — the bar's five
                      uppercase links plus the logo already fill the row at the
                      768px md breakpoint, and a seventh control overflows it.
                      Same surface as the mobile sheet below, so the control is
                      in one predictable place on both. */}
                  <div className="mt-1 border-t border-sand px-1 pt-1">
                    <SimpleModeToggle className="w-full justify-start" />
                  </div>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile bottom bar — pad for the iOS home-indicator inset */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-sand bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
        aria-label="Mobile"
      >
        <div
          className="grid"
          style={{
            // One equal column per surviving link plus the More button —
            // Tailwind can't JIT a dynamic grid-cols-N class.
            gridTemplateColumns: `repeat(${bottomBarLinks.length + 1}, minmax(0, 1fr))`,
          }}
        >
          {bottomBarLinks.map((l) => {
            const current = l.href === "/" ? pathname === "/" : isActive(l.href);
            // The tab highlight was colour-only (text-sound vs text-ink-soft at
            // one weight) — M-14-04. Weight plus the marker bar below now carry
            // it for anyone who can't separate the two hues.
            //
            // E14 contrast: the inactive label was text-ink-soft at 11px on this
            // translucent bar and measured 4.23:1 — under AA 1.4.3, on chrome
            // that is on every page at phone width. text-ink is 14.8:1 and the
            // active/inactive distinction is carried by weight, hue (sound vs
            // ink) and the marker bar, none of which is colour alone.
            const lit = current && !sheetOpen;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setSheetOpen(false)}
                aria-current={current ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[0.6875rem] ${
                  lit ? "font-semibold text-sound" : "font-medium text-ink"
                }`}
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  {l.icon}
                </span>
                {l.label}
                <span
                  aria-hidden="true"
                  className={`h-0.5 w-5 rounded-full ${lit ? "bg-sound" : "bg-transparent"}`}
                />
              </Link>
            );
          })}
          <button
            type="button"
            ref={sheetTriggerRef}
            onClick={() => setSheetOpen((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[0.6875rem] ${
              sheetOpen ? "font-semibold text-sound" : "font-medium text-ink"
            }`}
            aria-expanded={sheetOpen}
            aria-controls={MORE_SHEET_ID}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ☰
            </span>
            More
            <span
              aria-hidden="true"
              className={`h-0.5 w-5 rounded-full ${sheetOpen ? "bg-sound" : "bg-transparent"}`}
            />
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      {sheetOpen && (
        <div
          id={MORE_SHEET_ID}
          ref={sheetRef}
          className="fixed inset-x-0 bottom-[calc(3.4rem+env(safe-area-inset-bottom))] z-30 border-t border-sand bg-white p-4 shadow-[0_-8px_24px_rgba(22,64,94,0.12)] md:hidden print:hidden"
        >
          <div className="grid grid-cols-2 gap-2">
            {[...primary.filter((l) => !["/ferry", "/eat", "/events"].includes(l.href)), ...more].map(
              (l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setSheetOpen(false)}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className={`rounded-xl px-4 py-3 text-sm font-medium ${
                    isActive(l.href) ? "bg-sound text-white" : "bg-sand/60 text-ink"
                  }`}
                >
                  {l.label}
                </Link>
              ),
            )}
          </div>
          {/* E14: the "Easy read" switch (M-14-03). Sheet-level rather than a
              grid cell — it changes the whole page, it does not navigate. */}
          <div className="mt-3 border-t border-sand pt-2">
            <SimpleModeToggle className="w-full justify-start" />
          </div>
        </div>
      )}
    </>
  );
}
