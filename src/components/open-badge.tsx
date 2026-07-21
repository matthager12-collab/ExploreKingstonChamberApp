"use client";

// Live "Open now / Closed" badge computed in the visitor's browser so static
// pages never show stale state. Renders nothing until mounted (avoids a
// server/client hydration mismatch) and re-checks every minute.

import { useEffect, useState } from "react";
import type { WeeklyHours } from "@/lib/types";
import { getOpenStatus, type OpenStatus } from "@/lib/hours";

/**
 * Small line rendered beside ordering buttons: warns when the kitchen is
 * closed so nobody places an order into the void. Silent while open.
 */
export function OrderTimingNote({ weeklyHours }: { weeklyHours?: WeeklyHours }) {
  const [status, setStatus] = useState<OpenStatus | null>(null);

  useEffect(() => {
    if (!weeklyHours) return;
    const update = () => setStatus(getOpenStatus(weeklyHours));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [weeklyHours]);

  if (!status || status.open) return null;

  return (
    <p className="mt-2 w-full text-xs font-medium text-coral-deep">
      {status.label} — you can still browse the menu.
    </p>
  );
}

export function OpenBadge({ weeklyHours }: { weeklyHours?: WeeklyHours }) {
  const [status, setStatus] = useState<OpenStatus | null>(null);

  useEffect(() => {
    if (!weeklyHours) return;
    const update = () => setStatus(getOpenStatus(weeklyHours));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [weeklyHours]);

  if (!status) return null;

  return (
    <span
      // E14 contrast: the tinted pairs failed at this 12px size — text-fern on
      // bg-fern/10 measured 4.29:1 and text-ink-soft on bg-sand 3.62:1. Solid
      // fern with white text is 4.81:1 and sand with text-ink is 11.95:1. Fixed
      // at the usage site; no --color-* token value changed.
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        status.open ? "bg-fern text-white" : "bg-sand text-ink"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.open ? "bg-white" : "bg-ink/40"}`}
        aria-hidden
      />
      {status.label}
    </span>
  );
}
