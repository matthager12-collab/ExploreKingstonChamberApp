"use client";

// Live "Next Ferries" module for the Edmonds–Kingston car ferry — the home page's
// hero widget. Per direction it shows the delay, the next couple of sailings with
// a live countdown and open car spots, plus a service-alert banner and a
// boarding-pass indicator, and expands to the full day's times.
//
// Receives server-fetched data as props (so it renders instantly and works
// without JS), then polls /api/ferry/status every 60s and ticks the countdown
// every 20s. Pauses polling while the tab is hidden.
//
// `tone` themes it for its surroundings: "light" = a white card (the original
// look, kept for reuse on pale backgrounds); "dark" = bare, light-on-navy so it
// lives inside the hero's blue live-strip. All colors flow from the THEME map so
// the two variants never drift.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPacificTime } from "@/lib/time";
import type { WaterSide } from "@/lib/side";
import {
  FERRY_DIRS,
  REMINDER_LEAD_MIN,
  reminderIcsUrl,
  type FerryDir,
} from "@/lib/ferry-reminder";

interface Sailing {
  direction: "to-kingston" | "from-kingston";
  departs: string;
  vessel?: string;
}
interface SailingSpace {
  departs: string;
  vessel: string;
  driveUpSpaces: number | null;
  maxSpaces: number | null;
}
export interface FerryStatus {
  carFerry: { sailings: Sailing[]; live: boolean };
  alerts: string[];
  delays: { toKingston: number | null; fromKingston: number | null };
  sailingSpace: { kingston: SailingSpace[]; edmonds: SailingSpace[] };
  boardingPass: { active: boolean; reason: string };
}

type Tone = "light" | "dark";

// Every color the widget uses, per tone. Layout classes stay inline in the JSX;
// only the palette lives here, so "light" and "dark" render identically in
// structure and can never fall out of sync.
const THEME: Record<
  Tone,
  {
    root: string;
    heading: string;
    live: string;
    liveDot: string;
    link: string;
    boarding: string;
    alert: string;
    dirLabel: string;
    delayLate: string;
    delayOnTime: string;
    spotsFull: string;
    spotsLow: string;
    spotsPlenty: string;
    time: string;
    countdown: string;
    done: string;
    expander: string;
    note: string;
    noteLink: string;
    remind: string;
    remindActive: string;
  }
> = {
  light: {
    root: "rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]",
    heading: "text-sound-deep",
    live: "bg-fern/10 text-fern",
    liveDot: "bg-fern",
    link: "text-tide-deep hover:text-sound",
    boarding: "bg-coral/10 text-coral-deep",
    alert: "bg-amber-50 text-amber-900",
    dirLabel: "text-sound-deep",
    delayLate: "bg-coral/15 text-coral-deep",
    delayOnTime: "bg-fern/10 text-fern",
    spotsFull: "bg-coral/15 text-coral-deep",
    spotsLow: "bg-amber-100 text-amber-800",
    spotsPlenty: "bg-fern/10 text-fern",
    time: "text-ink",
    countdown: "text-ink-soft",
    done: "text-ink-soft",
    expander: "text-tide-deep hover:text-sound",
    note: "text-ink-soft",
    noteLink: "underline",
    remind: "text-tide-deep hover:text-sound",
    remindActive: "text-fern",
  },
  dark: {
    root: "",
    heading: "text-white",
    live: "bg-fern/25 text-white",
    liveDot: "bg-fern",
    link: "text-seaglass hover:text-white",
    boarding: "bg-coral/25 text-white",
    alert: "bg-amber-300/15 text-amber-100",
    dirLabel: "text-white",
    delayLate: "bg-coral text-white",
    delayOnTime: "bg-fern/25 text-white",
    spotsFull: "bg-coral text-white",
    spotsLow: "bg-amber-300/25 text-amber-100",
    spotsPlenty: "bg-fern/30 text-white",
    time: "text-white",
    countdown: "text-seaglass",
    done: "text-white/70",
    expander: "text-seaglass hover:text-white",
    note: "text-seaglass/80",
    noteLink: "text-white underline",
    remind: "text-seaglass hover:text-white",
    remindActive: "text-white",
  },
};

type Theme = (typeof THEME)[Tone];

const POLL_MS = 60_000;
const TICK_MS = 20_000;

function countdown(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} hr ${m} min` : `in ${h} hr`;
}

/** Match a sailing to its open-space record by nearest departure time (±3 min). */
function spaceFor(space: SailingSpace[], departs: string): SailingSpace | undefined {
  const t = Date.parse(departs);
  let best: SailingSpace | undefined;
  let bestDiff = 3 * 60_000;
  for (const s of space) {
    const diff = Math.abs(Date.parse(s.departs) - t);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Stable reminder key for a sailing. Normalizes the instant to canonical ISO so
 * the same departure keyed from the live ("…Z") and fallback ("…-07:00") forms
 * collapses to one key — otherwise a fallback→live poll would orphan the armed
 * key (button flips back to "Remind"; a re-arm double-fires).
 */
function reminderKey(dir: FerryDir, departs: string): string {
  const d = new Date(departs);
  return `${dir}|${Number.isNaN(d.getTime()) ? departs : d.toISOString()}`;
}

function SpotsBadge({ space, t }: { space?: SailingSpace; t: Theme }) {
  if (!space || space.driveUpSpaces === null) return null;
  const n = space.driveUpSpaces;
  const tone = n === 0 ? t.spotsFull : n < 20 ? t.spotsLow : t.spotsPlenty;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {n === 0 ? "Boat full" : `${n} car spots`}
    </span>
  );
}

function DirectionColumn({
  label,
  dir,
  sailings,
  space,
  delayMin,
  now,
  expanded,
  armed,
  onToggleNotify,
  t,
}: {
  label: string;
  dir: FerryDir;
  sailings: Sailing[];
  space: SailingSpace[];
  delayMin: number | null;
  now: number;
  expanded: boolean;
  armed: Set<string>;
  onToggleNotify: (dir: FerryDir, departs: string) => void;
  t: Theme;
}) {
  const upcoming = sailings
    .filter((s) => Date.parse(s.departs) > now - 90_000)
    .sort((a, b) => Date.parse(a.departs) - Date.parse(b.departs));
  const shown = expanded ? upcoming : upcoming.slice(0, 2);

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <p className={`font-nav text-sm font-semibold tracking-wide uppercase ${t.dirLabel}`}>
          → {label}
        </p>
        {delayMin !== null && delayMin >= 5 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.delayLate}`}>
            ~{delayMin} min late
          </span>
        )}
        {delayMin !== null && delayMin < 5 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.delayOnTime}`}>
            On time
          </span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className={`mt-2 text-sm ${t.done}`}>Done for today</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {shown.map((s) => {
            const key = reminderKey(dir, s.departs);
            const isArmed = armed.has(key);
            return (
              <li key={s.departs} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`text-lg font-semibold ${t.time}`}>
                  {formatPacificTime(s.departs)}
                </span>
                <span className={`text-sm ${t.countdown}`}>· {countdown(s.departs, now)}</span>
                <SpotsBadge space={spaceFor(space, s.departs)} t={t} />
                <span className="ml-auto flex items-center gap-3 text-xs font-medium">
                  <a
                    href={reminderIcsUrl(dir, s.departs)}
                    className={`inline-flex items-center gap-1 ${t.remind}`}
                    title={`Add to your calendar with a ${REMINDER_LEAD_MIN}-minute heads-up`}
                    aria-label={`Add the ${formatPacificTime(s.departs)} sailing to your calendar`}
                  >
                    <span aria-hidden>📅</span> Calendar
                  </a>
                  <button
                    type="button"
                    onClick={() => onToggleNotify(dir, s.departs)}
                    className={`inline-flex items-center gap-1 ${isArmed ? t.remindActive : t.remind}`}
                    title={`Get a browser alert about ${REMINDER_LEAD_MIN} min before it leaves (keep this tab open)`}
                    aria-pressed={isArmed}
                    aria-label={`Notify me before the ${formatPacificTime(s.departs)} sailing`}
                  >
                    <span aria-hidden>🔔</span> {isArmed ? "Reminding" : "Remind"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function NextFerries({
  initial,
  tone = "light",
  side = "kingston",
}: {
  initial: FerryStatus;
  tone?: Tone;
  side?: WaterSide;
}) {
  const t = THEME[tone];
  const [data, setData] = useState<FerryStatus>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Opt-in in-page reminders: `armed` holds "dir|departs" keys; `firedRef` keeps
  // a fired reminder from re-firing across the 20s ticks. Notifications only work
  // while this tab is open — the calendar (.ics) link is the reliable path.
  const [armed, setArmed] = useState<Set<string>>(() => new Set());
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
  const firedRef = useRef<Set<string>>(new Set());

  async function toggleNotify(dir: FerryDir, departs: string) {
    const key = reminderKey(dir, departs);
    setNotifyMsg(null);
    if (armed.has(key)) {
      setArmed((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifyMsg("This browser can't show alerts — use Calendar instead.");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = "denied";
      }
    }
    if (perm !== "granted") {
      setNotifyMsg("Notifications are off — allow them for this site, or use Calendar instead.");
      return;
    }
    firedRef.current.delete(key);
    setArmed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setNotifyMsg(
      `We'll alert you about ${REMINDER_LEAD_MIN} min before — keep this tab open. Calendar works even when it's closed.`,
    );
  }

  // Fire due reminders on each tick while the tab is open. A key fires once when
  // `now` first reaches its lead window; keys already past a grace window (a long
  // sleep, or a sailing that dropped out of the feed) are pruned WITHOUT firing,
  // so no stale "leaving soon" pops hours late and orphaned keys don't linger. If
  // a reminder comes due but notifications got turned off, we surface a message
  // rather than swallow it.
  useEffect(() => {
    if (armed.size === 0) return;
    const leadMs = REMINDER_LEAD_MIN * 60_000;
    const graceMs = 15 * 60_000;
    const canNotify =
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted";
    const toDisarm: string[] = [];
    let missed = false;
    armed.forEach((key) => {
      if (firedRef.current.has(key)) return;
      const sep = key.indexOf("|");
      const dir = key.slice(0, sep) as FerryDir;
      const departs = key.slice(sep + 1);
      const target = Date.parse(departs);
      // Invalid, or too late to be useful → drop it silently.
      if (Number.isNaN(target) || now > target + graceMs) {
        firedRef.current.add(key);
        toDisarm.push(key);
        return;
      }
      if (now >= target - leadMs) {
        firedRef.current.add(key);
        toDisarm.push(key);
        if (canNotify) {
          const mins = Math.max(0, Math.round((target - now) / 60_000));
          new Notification("Ferry leaving soon", {
            body: `${FERRY_DIRS[dir]?.label ?? "Ferry"} at ${formatPacificTime(departs)} — about ${mins} min. Time to head to the dock.`,
            tag: key,
          });
        } else {
          missed = true;
        }
      }
    });
    if (missed) {
      setNotifyMsg(
        "A ferry you're watching is leaving soon — notifications are off, so keep an eye on the times above.",
      );
    }
    if (toDisarm.length > 0) {
      setArmed((prev) => {
        const next = new Set(prev);
        toDisarm.forEach((k) => next.delete(k));
        return next;
      });
    }
  }, [now, armed]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    async function refresh() {
      try {
        const res = await fetch("/api/ferry/status");
        if (res.ok) {
          const json = (await res.json()) as FerryStatus;
          setData(json);
          setNow(Date.now());
        }
      } catch {
        // keep last-known data on a failed poll
      }
    }
    function startPoll() {
      if (pollRef.current) return;
      pollRef.current = setInterval(refresh, POLL_MS);
    }
    function stopPoll() {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    function onVisibility() {
      if (document.hidden) stopPoll();
      else {
        refresh();
        startPoll();
      }
    }
    startPoll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(tick);
      stopPoll();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className={t.root}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className={`font-display text-lg font-semibold ${t.heading}`}>Next ferries</h2>
          {data.carFerry.live && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${t.live}`}
            >
              {/* Decorative — "Live" beside it carries the state (open-badge.tsx). */}
              <span
                aria-hidden
                className={`h-1.5 w-1.5 animate-pulse rounded-full ${t.liveDot}`}
              />{" "}
              Live
            </span>
          )}
        </div>
        <Link
          href="/ferry"
          className={`text-sm font-semibold underline decoration-seaglass underline-offset-2 ${t.link}`}
        >
          Full schedule →
        </Link>
      </div>

      {/* The SR-104 boarding-pass line is a Kingston-DEPARTURE thing. Across the
          water you board at Edmonds, so it doesn't apply — hide it on that side. */}
      {side === "kingston" && data.boardingPass.active && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${t.boarding}`}>
          🚗 <span className="font-semibold">Vehicle boarding pass in effect.</span> Drivers: get in
          the SR-104 line and take a pass — don&apos;t drive straight to the dock.
        </div>
      )}

      {data.alerts.length > 0 && (
        <div className={`mt-3 space-y-1 rounded-lg px-3 py-2 text-sm ${t.alert}`}>
          {data.alerts.slice(0, 3).map((a, i) => (
            <p key={i}>⚠️ {a}</p>
          ))}
        </div>
      )}

      {/* Two directions. The DEPARTING side leads and is the only column that
          shows live drive-up space — the side you're waiting to board from.
          Kingston side → leaving Kingston (the "Edmonds" column) leads and shows
          sailingSpace.kingston. Edmonds side → leaving Edmonds (the "Kingston"
          column) leads and shows sailingSpace.edmonds. The arriving column shows
          times only (space=[]). */}
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:gap-8">
        {(() => {
          const leavingKingston = (
            <DirectionColumn
              key="from-kingston"
              label="Edmonds"
              dir="from-kingston"
              sailings={data.carFerry.sailings.filter((s) => s.direction === "from-kingston")}
              space={side === "kingston" ? data.sailingSpace.kingston : []}
              delayMin={data.delays.fromKingston}
              now={now}
              expanded={expanded}
              armed={armed}
              onToggleNotify={toggleNotify}
              t={t}
            />
          );
          const leavingEdmonds = (
            <DirectionColumn
              key="to-kingston"
              label="Kingston"
              dir="to-kingston"
              sailings={data.carFerry.sailings.filter((s) => s.direction === "to-kingston")}
              space={side === "edmonds" ? data.sailingSpace.edmonds : []}
              delayMin={data.delays.toKingston}
              now={now}
              expanded={expanded}
              armed={armed}
              onToggleNotify={toggleNotify}
              t={t}
            />
          );
          return side === "edmonds"
            ? [leavingEdmonds, leavingKingston]
            : [leavingKingston, leavingEdmonds];
        })()}
      </div>

      {/* Always mounted so screen readers announce the Remind outcome on change. */}
      <p
        role="status"
        aria-live="polite"
        className={notifyMsg ? `mt-3 text-xs ${t.note}` : "sr-only"}
      >
        {notifyMsg ?? ""}
      </p>

      <button
        onClick={() => setExpanded((v) => !v)}
        className={`mt-4 text-sm font-medium ${t.expander}`}
        aria-expanded={expanded}
      >
        {expanded ? "Show fewer times ▴" : "More times today ▾"}
      </button>

      {!data.carFerry.live && (
        <p className={`mt-2 text-xs ${t.note}`}>
          Schedule times, not live status — confirm at{" "}
          <a
            href="https://wsdot.wa.gov/travel/washington-state-ferries"
            target="_blank"
            rel="noopener noreferrer"
            className={t.noteLink}
          >
            wsdot.wa.gov/ferries
          </a>
          .
        </p>
      )}
    </div>
  );
}
