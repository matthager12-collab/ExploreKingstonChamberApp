"use client";

// The counting-window controls at the top of /admin:
//   1. The BASELINE — "start counting from now", and its undo. Moves a
//      watermark; deletes nothing (see analytics-baseline-store.ts).
//   2. This device's INTERNAL flag — whether the browser you are reading this
//      in is counted as a visitor.
//   3. The exclusion RECEIPT — how much traffic the internal filter caught,
//      which is the only way to tell a working filter from a quiet week.
//
// Authorization is server-side (/api/admin/analytics-baseline requires role
// admin). Plain fetch + router.refresh(), like the sibling ferry controls.

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import {
  internalDeviceServerSnapshot,
  isInternalDevice,
  setInternalDevice,
  subscribeInternalDevice,
} from "@/components/tracker";

export interface BaselineState {
  since: string | null;
  setAt: string;
  setBy: string;
  note?: string;
}

const btn =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-60";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function AnalyticsBaselineControl({
  baseline,
  internal,
}: {
  baseline: BaselineState | null;
  internal: { events: number; sessions: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read straight from the external store rather than copying it into state:
  // localStorage is not React-owned, it can change in another tab, and this
  // page's client components never unmount. `null` during SSR means "not known
  // yet" and renders as "Checking…".
  const deviceInternal = useSyncExternalStore(
    subscribeInternalDevice,
    isInternalDevice,
    internalDeviceServerSnapshot,
  );

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/analytics-baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // No local state to update — setInternalDevice notifies every subscriber,
  // and useSyncExternalStore re-reads. One source of truth, in localStorage.
  function toggleDevice() {
    setInternalDevice(!deviceInternal);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Counting window</p>
          <p className="mt-1 text-sm text-ink-soft">
            {baseline?.since ? (
              <>
                Every number on this page counts activity since{" "}
                <strong className="text-ink">{fmtWhen(baseline.since)}</strong>
                {baseline.note ? ` (${baseline.note})` : ""}. Earlier events are still stored —
                they are hidden, not deleted.
              </>
            ) : (
              <>
                Counting <strong className="text-ink">everything ever recorded</strong>, including
                development and testing. Start a fresh count when the site opens to the public.
              </>
            )}
          </p>
          {baseline && (
            <p className="mt-1 text-xs text-ink-soft">
              Set by {baseline.setBy} on {fmtWhen(baseline.setAt)}.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => post({ note: "reset from dashboard" })}
                className={`${btn} bg-coral text-white hover:opacity-90`}
              >
                {busy ? "Working…" : "Confirm — start from now"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className={`${btn} border border-sand bg-white text-ink hover:bg-sand/30`}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className={`${btn} bg-sound text-white hover:bg-sound-deep`}
            >
              ↻ Start counting from now
            </button>
          )}
          {baseline?.since && !confirming && (
            <button
              type="button"
              disabled={busy}
              onClick={() => post({ since: null })}
              className={`${btn} border border-sand bg-white text-ink hover:bg-sand/30`}
            >
              Show all history
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sand pt-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">This device</p>
          <p className="mt-1 text-sm text-ink-soft">
            {deviceInternal === null ? (
              "Checking…"
            ) : deviceInternal ? (
              <>
                Excluded — nothing you do in this browser is counted as a visit.{" "}
                <Badge tone="teal">Excluded</Badge>
              </>
            ) : (
              <>
                Counted as a visitor. Chamber staff logins are excluded automatically; turn this on
                for a device that browses signed out.
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            To exclude someone else&rsquo;s phone or tablet, send them a link ending in{" "}
            <code className="rounded bg-sand/40 px-1">?vk-internal=1</code> — opening it once is
            enough. <code className="rounded bg-sand/40 px-1">?vk-internal=0</code> undoes it.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleDevice}
          disabled={deviceInternal === null}
          className={`${btn} shrink-0 border border-sand bg-white text-ink hover:bg-sand/30`}
        >
          {deviceInternal ? "Count this device" : "Exclude this device"}
        </button>
      </div>

      <p className="mt-4 border-t border-sand pt-4 text-sm text-ink-soft">
        {internal.events > 0 ? (
          <>
            <strong className="text-ink">{internal.events.toLocaleString()}</strong> events across{" "}
            <strong className="text-ink">{internal.sessions.toLocaleString()}</strong>{" "}
            {internal.sessions === 1 ? "session" : "sessions"} were recorded as ours in this window
            and left out of every number above.
          </>
        ) : (
          // Zero is ambiguous and the reader deserves to know which zero it is:
          // "the filter caught nothing" and "the filter is not running" look
          // identical from a count alone.
          <>
            No internal traffic recorded in this window — either nobody on the Chamber side has
            used the site since the counting window started, or this device and the staff logins
            simply haven&rsquo;t been active.
          </>
        )}
      </p>
    </Card>
  );
}
