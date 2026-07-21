import type { ReactNode } from "react";
import { OutboundLink } from "./tracker";

/** Deep link into Google Maps — works on every platform, no API key. */
export function mapSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function mapDirectionsUrl(destination: string, mode: "walking" | "driving" = "walking"): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
}

export function PageHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
}) {
  return (
    <header className="mx-auto max-w-5xl px-4 pt-10 pb-6 sm:pt-14">
      {eyebrow && (
        <p className="mb-2 text-sm font-semibold tracking-widest text-tide-deep uppercase">
          {eyebrow}
        </p>
      )}
      <h1 className="text-4xl font-semibold text-sound-deep sm:text-5xl">{title}</h1>
      {/* E14 contrast: muted gray (--color-ink-soft, #6b7683) measures 4.4993:1
          on the page fill (--color-shell) — under AA 1.4.3, and it fails on
          EVERY page because this is the shared page-intro primitive. It clears
          AA on a white card (4.62:1) but this paragraph sits on the page
          background, so it gets full ink (14.8:1). Hierarchy is carried by size
          and by the heading colour, not by a failing contrast ratio. Fixed at
          the usage site; no --color-* token value changed (E14 rule). */}
      {intro && <p className="mt-4 max-w-2xl text-lg text-ink">{intro}</p>}
    </header>
  );
}

export function Section({
  title,
  subtitle,
  children,
  id,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mx-auto max-w-5xl px-4 py-8 scroll-mt-24">
      {title && <h2 className="text-2xl font-semibold text-sound-deep sm:text-3xl">{title}</h2>}
      {/* Same page-background reasoning as PageHeader's intro above. */}
      {subtitle && <p className="mt-1 mb-2 text-ink">{subtitle}</p>}
      <div className={title ? "mt-5" : undefined}>{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)] ${className}`}
    >
      {children}
    </div>
  );
}

const badgeTones = {
  navy: "bg-sound text-white",
  teal: "bg-tide/10 text-tide-deep",
  coral: "bg-coral/10 text-coral-deep",
  // E14 contrast: text-fern on bg-fern/10 measured 4.29:1 at this 12px size —
  // under AA. Solid fern with white text is 4.81:1 and matches the navy tone's
  // shape. Fixed here, at the usage site; no --color-* token value changed.
  green: "bg-fern text-white",
  sand: "bg-sand text-ink",
} as const;

export function Badge({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Callout({
  title,
  children,
  tone = "teal",
}: {
  title: string;
  children: ReactNode;
  tone?: "teal" | "coral";
}) {
  const border = tone === "coral" ? "border-coral bg-coral/5" : "border-tide bg-tide/5";
  return (
    <div className={`rounded-xl border-l-4 p-4 ${border}`}>
      <p className="font-semibold text-sound-deep">{title}</p>
      {/* E14 contrast: text-ink-soft on the tinted fill measured 4.38:1 (under
          AA at 14px). text-ink on the same fill is 14.5:1. */}
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  // Outbound taps (menus, ordering, maps, bookings) feed the Chamber's LTAC
  // visitor data. OutboundLink is a client component that fires trackOutbound
  // onClick — no preventDefault; sendBeacon survives the navigation. It lives
  // in tracker.tsx so this module stays server-safe (server pages call
  // mapSearchUrl/mapDirectionsUrl above at render time).
  return (
    <OutboundLink
      href={href}
      className={`font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound ${className}`}
    >
      {children}
    </OutboundLink>
  );
}
