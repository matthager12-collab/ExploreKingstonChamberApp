"use client";

// Kiosk controls for /admin/kiosk (E22) — the Chamber's remote control for the
// physical panel at the ferry dock.
//
// Four things, in the order staff actually need them:
//   1. On/off — whether /kiosk answers the public at all. Ships OFF.
//   2. Which screens get a tile.
//   3. How long before an idle screen returns to the attract loop.
//   4. "Refresh the kiosk now" — the instant push, for when a minute is too long.
//
// Authorization is server-side (/api/admin/kiosk requires role admin). Plain
// fetch + local state, matching the sibling prediction and boarding-pass
// controls rather than introducing a fourth idiom on the same page family.

import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import {
  KIOSK_SCREENS,
  type KioskScreenId,
} from "@/lib/kiosk/screens";
import { MAX_IDLE_SECONDS, MIN_IDLE_SECONDS } from "@/lib/kiosk/limits";

export interface KioskSettingsView {
  enabled: boolean;
  enabledScreens: KioskScreenId[];
  idleSeconds: number;
  setAt: string | null;
  setBy: string | null;
}

const btn =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-100";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

type Busy = null | "on" | "off" | "screens" | "idle" | "refresh";

export function KioskControl({ initial }: { initial: KioskSettingsView }) {
  const [state, setState] = useState<KioskSettingsView>(initial);
  const [idleDraft, setIdleDraft] = useState(String(initial.idleSeconds));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { enabled, enabledScreens, idleSeconds, setAt, setBy } = state;

  async function save(patch: Record<string, unknown>, which: Busy, okMessage: string) {
    setBusy(which);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/admin/kiosk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as
        | { ok: true; settings: KioskSettingsView }
        | { error?: string };
      if (!res.ok || !("settings" in data)) {
        setError(("error" in data && data.error) || "Something went wrong");
        return;
      }
      setState(data.settings);
      setIdleDraft(String(data.settings.idleSeconds));
      setSaved(okMessage);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  function toggleScreen(id: KioskScreenId) {
    const next = enabledScreens.includes(id)
      ? enabledScreens.filter((s) => s !== id)
      : [...enabledScreens, id];
    // The server refuses to store an empty list (it would leave the attract
    // screen with no tiles — a kiosk nobody can use), so say so here rather
    // than letting the save silently restore the defaults.
    if (next.length === 0) {
      setError("Leave at least one screen on — a kiosk with no tiles cannot be used.");
      return;
    }
    void save({ enabledScreens: next }, "screens", "Screens updated.");
  }

  function saveIdle() {
    const n = Number(idleDraft);
    if (!Number.isFinite(n) || n < MIN_IDLE_SECONDS || n > MAX_IDLE_SECONDS) {
      setError(`Enter a number of seconds between ${MIN_IDLE_SECONDS} and ${MAX_IDLE_SECONDS}.`);
      return;
    }
    void save({ idleSeconds: n }, "idle", "Idle timeout updated.");
  }

  return (
    <Card className="mb-6 border-tide/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
            🖥️ Ferry-dock kiosk
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            The touchscreen by the ferry. It shows the same listings, events and ferry times as
            this website, so editing anything in admin updates the kiosk within about a minute —
            there is nothing separate to keep up to date.
          </p>
        </div>
        <Badge tone={enabled ? "green" : "sand"}>{enabled ? "Live at the dock" : "Off"}</Badge>
      </div>

      {/* 1. On/off */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save({ enabled: true }, "on", "Kiosk turned on.")}
          disabled={busy !== null || enabled}
          className={`${btn} ${
            enabled
              ? "bg-fern text-white ring-2 ring-fern ring-offset-1"
              : "bg-fern text-white hover:ring-2 hover:ring-fern hover:ring-offset-1"
          }`}
        >
          {busy === "on" ? "Saving…" : enabled ? "✓ Kiosk is on" : "Turn the kiosk on"}
        </button>
        <button
          type="button"
          onClick={() => void save({ enabled: false }, "off", "Kiosk turned off.")}
          disabled={busy !== null || !enabled}
          className={`${btn} ${
            !enabled
              ? "bg-sound text-white ring-2 ring-sound ring-offset-1"
              : "border border-sand bg-white text-ink hover:border-tide"
          }`}
        >
          {busy === "off" ? "Saving…" : !enabled ? "✓ Off" : "Turn the kiosk off"}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        {setAt && setBy ? (
          <>
            Last changed by {setBy}
            {fmtWhen(setAt) ? ` · ${fmtWhen(setAt)}` : ""}.
          </>
        ) : (
          <>Never configured — the kiosk is off and its web address returns “page not found”.</>
        )}
      </p>
      <p className="mt-2 text-xs">
        <a
          href="/kiosk"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2"
        >
          Preview the kiosk →
        </a>{" "}
        <span className="text-ink-soft">
          — opens in a new tab. Admins can see it even while it is off; the public cannot.
        </span>
      </p>

      {/* 2. Screens */}
      <div className="mt-5 border-t border-sand pt-4">
        <p className="font-semibold text-sound-deep">Which screens does it show?</p>
        <p className="mt-1 text-sm text-ink-soft">
          Each one becomes a large button on the kiosk&rsquo;s home screen. Fewer is better for
          someone in a hurry to catch a boat.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {KIOSK_SCREENS.map((screen) => {
            const on = enabledScreens.includes(screen.id);
            return (
              <li key={screen.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-sand bg-white px-3 py-2 hover:border-tide">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy !== null}
                    onChange={() => toggleScreen(screen.id)}
                    className="size-5 accent-tide-deep"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      <span aria-hidden="true">{screen.icon}</span> {screen.label}
                    </span>
                    <span className="block text-xs text-ink-soft">{screen.blurb}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 3. Idle timeout */}
      <div className="mt-5 border-t border-sand pt-4">
        <label htmlFor="kiosk-idle" className="font-semibold text-sound-deep">
          Return to the welcome screen after
        </label>
        <p className="mt-1 text-sm text-ink-soft">
          How long the kiosk waits, with nobody touching it, before it clears what the last person
          was looking at and goes back to the welcome screen.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            id="kiosk-idle"
            type="number"
            inputMode="numeric"
            min={MIN_IDLE_SECONDS}
            max={MAX_IDLE_SECONDS}
            value={idleDraft}
            disabled={busy !== null}
            onChange={(e) => setIdleDraft(e.target.value)}
            className="w-28 rounded-lg border border-sand px-3 py-2 text-ink"
          />
          <span className="text-sm text-ink-soft">
            seconds ({MIN_IDLE_SECONDS}&ndash;{MAX_IDLE_SECONDS}; currently {idleSeconds})
          </span>
          <button
            type="button"
            onClick={saveIdle}
            disabled={busy !== null || idleDraft === String(idleSeconds)}
            className={`${btn} border border-sand bg-white text-tide-deep hover:border-tide disabled:opacity-50`}
          >
            {busy === "idle" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* 4. Instant push */}
      <div className="mt-5 border-t border-sand pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sound-deep">Refresh the kiosk now</p>
            <p className="mt-1 text-sm text-ink-soft">
              Edits normally reach the kiosk within about a minute on their own. Use this if
              something needs to be right on the screen immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void save({}, "refresh", "Kiosk refreshed.")}
            disabled={busy !== null}
            className={`${btn} border border-sand bg-white text-tide-deep hover:border-tide disabled:opacity-50`}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-coral-deep">
          {error}
        </p>
      )}
      {saved && !error && (
        // text-fern on the card's white ground is 4.86:1 — AA, and safe because
        // there is no tint under it. Do NOT add a bg-fern/N wash here: the pair
        // drops to 4.29:1 and tests/unit/a11y-static-invariants.test.ts fails.
        <p role="status" className="mt-3 text-sm text-fern">
          {saved}
        </p>
      )}
    </Card>
  );
}
