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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        status.open ? "bg-fern/10 text-fern" : "bg-sand text-ink-soft"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.open ? "bg-fern" : "bg-ink-soft/50"}`}
        aria-hidden
      />
      {status.label}
    </span>
  );
}
