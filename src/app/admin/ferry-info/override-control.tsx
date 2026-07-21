"use client";

// Boarding-pass override control for /admin/ferry-info. Sits above the fact
// editor because it's the fastest-changing lever staff have: pin the SR-104
// boarding-pass verdict ON or OFF for the rest of today, or hand it back to the
// automatic estimate. The pin lapses on its own at the next Pacific midnight, so
// this is a same-day nudge, not a lasting setting.
//
// All authorization is server-side — this talks to /api/admin/boarding-pass,
// which requires role admin. Deliberately plain (fetch + local state), like the
// sibling editor.

import { useState } from "react";
import { Badge, Card } from "@/components/ui";

interface Verdict {
  active: boolean;
  reason: string;
  source: "estimate" | "override";
}
interface OverrideRecord {
  active: boolean;
  day: string;
  setAt: string;
  setBy: string;
}
export interface BoardingPassState {
  estimate: Verdict;
  override: OverrideRecord | null;
  effective: Verdict;
}

const buttonBase =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-100";

function fmtSetAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function BoardingPassOverrideControl({ initial }: { initial: BoardingPassState }) {
  const [state, setState] = useState<BoardingPassState>(initial);
  const [busy, setBusy] = useState<null | "on" | "off" | "auto">(null);
  const [error, setError] = useState<string | null>(null);

  const { effective, estimate, override } = state;
  const isOverride = effective.source === "override";
  const pinnedOn = isOverride && effective.active;
  const pinnedOff = isOverride && !effective.active;

  async function apply(action: "on" | "off" | "auto") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/boarding-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | (BoardingPassState & { ok: true })
        | { error?: string };
      if (!res.ok || !("effective" in data)) {
        setError(("error" in data && data.error) || "Something went wrong");
        return;
      }
      setState({ estimate: data.estimate, override: data.override, effective: data.effective });
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-6 border-coral/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
            🚗 Boarding-pass status (today)
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Pin the SR-104 vehicle boarding-pass on or off for the rest of today. It steers the home
            ferry widget and the &ldquo;get in the ferry line&rdquo; directions. Resets to automatic
            at midnight.
          </p>
        </div>
        <Badge tone={effective.active ? "coral" : "green"}>
          {effective.active ? "Pass ON" : "Pass off"}
        </Badge>
      </div>

      <p className="mt-3 text-sm text-ink">
        <span className="font-semibold">Right now:</span> {effective.reason}
      </p>

      {isOverride && override ? (
        <p className="mt-1 text-xs text-coral-deep">
          Set to <strong>{override.active ? "ON" : "OFF"}</strong> by {override.setBy}
          {fmtSetAt(override.setAt) ? ` at ${fmtSetAt(override.setAt)}` : ""} — reverts overnight.
          Automatic guess for now would be <strong>{estimate.active ? "ON" : "off"}</strong>.
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">
          Following the automatic guess. No staff override set for today.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => apply("on")}
          disabled={busy !== null || pinnedOn}
          className={`${buttonBase} ${
            pinnedOn
              ? "bg-coral text-white ring-2 ring-coral-deep ring-offset-1"
              : "bg-coral/90 text-white hover:bg-coral-deep"
          }`}
        >
          {busy === "on" ? "Saving…" : pinnedOn ? "✓ Pinned ON" : "Turn ON for today"}
        </button>
        <button
          type="button"
          onClick={() => apply("off")}
          disabled={busy !== null || pinnedOff}
          className={`${buttonBase} ${
            pinnedOff
              ? "bg-fern text-white ring-2 ring-fern ring-offset-1"
              : "bg-fern/90 text-white hover:bg-fern"
          }`}
        >
          {busy === "off" ? "Saving…" : pinnedOff ? "✓ Pinned OFF" : "Turn OFF for today"}
        </button>
        <button
          type="button"
          onClick={() => apply("auto")}
          disabled={busy !== null || !isOverride}
          className={`${buttonBase} border border-sand bg-white text-tide-deep hover:border-tide disabled:opacity-50`}
        >
          {busy === "auto" ? "Saving…" : "Use automatic"}
        </button>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-coral-deep">{error}</p>}
    </Card>
  );
}
