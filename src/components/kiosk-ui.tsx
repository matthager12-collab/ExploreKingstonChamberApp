// Shared furniture for the kiosk screens.
//
// SIZES ARE THE POINT. Everything here is built to the kiosk touch floor from
// the E22 charter: interactive targets at least 60px (3.75rem) on the 1080x1920
// stage, body text at least 24px (1.5rem). Those are not house-style numbers —
// they are what a person reads at arm's length, standing, in a hurry, on a
// glossy panel in daylight, and they are why these screens are NOT the mobile
// pages rendered at a different width.
//
// Sizes use Tailwind's rem scale rather than arbitrary px utilities, both
// because tests/unit/a11y-static-invariants.test.ts forbids `text-[Npx]` in
// src/ and because the stage is transform-scaled: rem keeps every proportion
// intact on a replacement panel of another size.

import Link from "next/link";
import type { ReactNode } from "react";

/** A full kiosk screen: fixed header with a way home, then scrollable body. */
export function KioskScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-sound-deep">
      <header className="flex shrink-0 items-center gap-8 border-b border-white/15 px-12 py-10">
        {/* Home is ALWAYS in the same place on every screen. A kiosk has no
            browser back button, so this is the only way out of a dead end, and
            a visitor must never have to hunt for it. */}
        <Link
          href="/kiosk"
          className="flex min-h-[5rem] min-w-[5rem] items-center justify-center rounded-2xl bg-white/15 px-8 text-4xl font-semibold text-white"
          aria-label="Back to the kiosk home screen"
        >
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="font-display text-6xl leading-tight font-semibold text-white">{title}</h1>
          {subtitle && <p className="mt-2 text-3xl text-white/70">{subtitle}</p>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-12 py-10">{children}</div>
    </div>
  );
}

/** One listing on a kiosk list screen. */
export function KioskCard({
  title,
  meta,
  body,
  badge,
  aside,
}: {
  title: string;
  meta?: string;
  body?: string;
  badge?: ReactNode;
  /** Usually a QR code. Sits right of the text on the wide portrait stage. */
  aside?: ReactNode;
}) {
  return (
    <article className="mb-8 flex items-start gap-10 rounded-3xl bg-white/10 p-10">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-5">
          <h2 className="text-5xl leading-tight font-semibold text-white">{title}</h2>
          {badge}
        </div>
        {meta && <p className="mt-4 text-3xl text-white/70">{meta}</p>}
        {body && <p className="mt-4 text-2xl leading-relaxed text-white/85">{body}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </article>
  );
}

/** Open / closed pill. Colour is never the only signal — the words carry it. */
export function KioskBadge({ tone, children }: { tone: "open" | "shut" | "info"; children: ReactNode }) {
  const tones = {
    // Solid fills with white text: on the navy stage a tint would sit under AA,
    // the same arithmetic that E14/E15 fixed across the site palette.
    open: "bg-fern text-white",
    shut: "bg-white/25 text-white",
    info: "bg-tide-deep text-white",
  } as const;
  return (
    <span className={`inline-flex rounded-full px-6 py-2 text-2xl font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** "Nothing here right now" — always says WHY, never just an empty screen. */
export function KioskEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl bg-white/10 p-12 text-center">
      <p className="text-3xl leading-relaxed text-white/85">{children}</p>
    </div>
  );
}
