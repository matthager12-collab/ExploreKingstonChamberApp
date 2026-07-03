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
      {intro && <p className="mt-4 max-w-2xl text-lg text-ink-soft">{intro}</p>}
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
      {subtitle && <p className="mt-1 mb-2 text-ink-soft">{subtitle}</p>}
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
  green: "bg-fern/10 text-fern",
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
      <div className="mt-1 text-sm text-ink-soft">{children}</div>
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
