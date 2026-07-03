"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
  { href: "/parking", label: "Parking & ATMs" },
  { href: "/hunt", label: "Scavenger Hunt" },
  { href: "/give", label: "Give Back" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Top header */}
      <header className="sticky top-0 z-40 border-b border-sand bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setSheetOpen(false)}>
            {/* Official Explore Kingston logo — black brush-script wordmark + #1E96C0 sailboat */}
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
            {primaryLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`font-nav rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wide uppercase transition-colors ${
                  isActive(l.href)
                    ? "bg-sound text-white"
                    : "text-ink hover:bg-seaglass/40 hover:text-sound"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
                className={`font-nav rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wide uppercase transition-colors ${
                  moreLinks.some((l) => isActive(l.href))
                    ? "bg-sound text-white"
                    : "text-ink hover:bg-seaglass/40 hover:text-sound"
                }`}
                aria-expanded={moreOpen}
              >
                More ▾
              </button>
              {moreOpen && (
                <div className="absolute right-0 mt-1 w-48 rounded-xl border border-sand bg-white py-2 shadow-lg">
                  {moreLinks.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="block px-4 py-2 text-sm text-ink hover:bg-seaglass/30 hover:text-sound"
                      onClick={() => setMoreOpen(false)}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile bottom bar — pad for the iOS home-indicator inset */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-sand bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Mobile"
      >
        <div className="grid grid-cols-5">
          {[
            { href: "/", label: "Home", icon: "⌂" },
            { href: "/ferry", label: "Ferry", icon: "⛴" },
            { href: "/eat", label: "Eat", icon: "🍽" },
            { href: "/events", label: "Events", icon: "📅" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setSheetOpen(false)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                (l.href === "/" ? pathname === "/" : isActive(l.href)) && !sheetOpen
                  ? "text-sound"
                  : "text-ink-soft"
              }`}
            >
              <span className="text-lg leading-none">{l.icon}</span>
              {l.label}
            </Link>
          ))}
          <button
            onClick={() => setSheetOpen((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
              sheetOpen ? "text-sound" : "text-ink-soft"
            }`}
            aria-expanded={sheetOpen}
          >
            <span className="text-lg leading-none">☰</span>
            More
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      {sheetOpen && (
        <div className="fixed inset-x-0 bottom-[calc(3.4rem+env(safe-area-inset-bottom))] z-30 border-t border-sand bg-white p-4 shadow-[0_-8px_24px_rgba(22,64,94,0.12)] md:hidden">
          <div className="grid grid-cols-2 gap-2">
            {[...primaryLinks.filter((l) => !["/ferry", "/eat", "/events"].includes(l.href)), ...moreLinks].map(
              (l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setSheetOpen(false)}
                  className={`rounded-xl px-4 py-3 text-sm font-medium ${
                    isActive(l.href) ? "bg-sound text-white" : "bg-sand/60 text-ink"
                  }`}
                >
                  {l.label}
                </Link>
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
