"use client";

// Live departure board for both Kingston ferries. Receives server-fetched
// data as props, then polls /api/ferry/status every 60s (paused while the
// tab is hidden). Countdown labels tick every 20s.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Sailing, TerminalStatus } from "@/lib/types";
import type { WaterSide } from "@/lib/side";
import { formatPacificDate, formatPacificTime } from "@/lib/time";
import { Badge, Card, ExternalLink } from "@/components/ui";

interface FeedState {
  sailings: Sailing[];
  live: boolean;
}

export interface FerryStatusPayload {
  carFerry: FeedState;
  fastFerry: FeedState;
  terminals: { kingston: TerminalStatus; edmonds: TerminalStatus };
  alerts: string[];
}

const POLL_MS = 60_000;
const TICK_MS = 20_000;

function countdown(departsIso: string, now: number): string {
  const mins = Math.round((Date.parse(departsIso) - now) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`;
}

/**
 * E13. WHEN the times on screen were last known good, and WHY they stopped
 * being live — two separate claims that used to share one label.
 *
 * "offline" is the visitor's network: a thrown fetch, or the worker handing
 * back its saved copy (the X-SW-Fetched-At stamp). "unavailable" is a resolved
 * response that isn't ok — most often our own server 500ing while the visitor
 * has four bars, so "Offline" would send them hunting for a signal problem
 * that is ours. The worker's synthetic 503 (fetch threw, nothing cached) lands
 * in that same branch, so the "unavailable" wording must stay true for a
 * genuinely offline reader too: it claims nothing either way about the network.
 */
type Stale = { at: string; reason: "offline" | "unavailable" };

/**
 * The saved instant as a Kingston wall-clock time, date-qualified whenever it
 * isn't today: a phone that has been offline since Friday would otherwise say
 * "as of 8:47 PM" on Sunday, which reads as tonight. `nowMs` is the ticking
 * `now` state rather than Date.now() so this stays a pure function of render
 * inputs. (next-ferries.tsx carries the same helper — no shared module for two
 * small copies.)
 */
function savedAtLabel(iso: string, nowMs: number): string {
  const day = formatPacificDate(iso);
  return day === formatPacificDate(new Date(nowMs).toISOString())
    ? formatPacificTime(iso)
    : `${day}, ${formatPacificTime(iso)}`;
}

/** Remaining sailings in one direction, soonest first (90s grace for a boat leaving right now). */
function upcoming(sailings: Sailing[], direction: Sailing["direction"], now: number): Sailing[] {
  return sailings
    .filter((s) => s.direction === direction && Date.parse(s.departs) > now - 90_000)
    .sort((a, b) => Date.parse(a.departs) - Date.parse(b.departs));
}

function TerminalNote({ status }: { status: TerminalStatus }) {
  if (!status.live || (status.driveUpSpaces === undefined && !status.waitEstimate)) return null;
  return (
    // E14 contrast: this panel only renders when WSDOT terminal data is LIVE
    // (see the guard above), so its two AA failures were invisible to any scan
    // that happened to run outside service hours — the axe smoke passed all
    // night and failed the next afternoon on identical code.
    //
    // Measured against the composited fill (seaglass/25 over shell = #eaf5fa):
    //   text-fern     #4a7c59  4.39:1  FAIL
    //   text-ink-soft #6b7683  4.17:1  FAIL
    //   text-ink      #20262e 13.74:1  pass
    // Lightening the tint instead would put fern at 4.53:1 — passing by 0.03,
    // which is the same knife-edge that hid the original --color-ink-soft bug
    // (4.4993:1) for months. Both go to text-ink; the tint is unchanged, and no
    // --color-* token VALUE was touched.
    //
    // "Live:" loses its green, which was decoration only — the word itself
    // carries the meaning, per the never-color-alone rule (M-14-04). Restoring
    // a green here needs a --color-fern-deep following the existing
    // tide-deep / coral-deep idiom, which is an ask-first palette change.
    <div className="mt-3 rounded-lg bg-seaglass/25 px-3 py-2 text-sm">
      {status.driveUpSpaces !== undefined && (
        <p className="text-ink">
          <span className="font-semibold">Live:</span> {status.driveUpSpaces} drive-up car spaces
          left on the next boat
        </p>
      )}
      {status.waitEstimate && <p className="mt-0.5 text-ink">{status.waitEstimate}</p>}
    </div>
  );
}

function DirectionColumn({
  label,
  sailings,
  now,
  emptyNote,
  footer,
}: {
  label: string;
  sailings: Sailing[];
  now: number;
  emptyNote: string;
  footer?: ReactNode;
}) {
  const next = sailings.slice(0, 3);
  return (
    <div>
      <p className="text-xs font-semibold tracking-widest text-ink-soft uppercase">{label}</p>
      {next.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{emptyNote}</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {next.map((s, i) => (
            <li key={s.departs} className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={`font-semibold text-sound-deep tabular-nums ${
                  i === 0 ? "text-4xl" : "text-xl"
                }`}
              >
                {formatPacificTime(s.departs)}
              </span>
              <span
                className={`text-sm font-medium ${i === 0 ? "text-coral-deep" : "text-ink-soft"}`}
              >
                {countdown(s.departs, now)}
              </span>
              {s.vessel && <span className="text-xs text-ink-soft">{s.vessel}</span>}
            </li>
          ))}
        </ol>
      )}
      {footer}
    </div>
  );
}

function RemainingList({ label, sailings }: { label: string; sailings: Sailing[] }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-widest text-ink-soft uppercase">{label}</p>
      {sailings.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">Done for today.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm text-ink">
          {sailings.map((s) => (
            <li key={s.departs} className="flex justify-between gap-4">
              <span className="tabular-nums">{formatPacificTime(s.departs)}</span>
              {s.vessel && <span className="truncate text-ink-soft">{s.vessel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FerryBoard({
  initial,
  serverNow,
  side = "kingston",
}: {
  initial: FerryStatusPayload;
  /** ISO timestamp from the server render, so SSR and hydration agree. */
  serverNow: string;
  side?: WaterSide;
}) {
  const [data, setData] = useState<FerryStatusPayload>(initial);
  const [now, setNow] = useState<number>(() => Date.parse(serverNow));
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // E13 staleness. The instant is an ISO string: the service worker stamps
  // X-SW-Fetched-At as ISO and formatPacificTime() takes an ISO string, so no
  // conversion is needed.
  const [stale, setStale] = useState<Stale | null>(null);
  // Must be a ref, not state: refresh() lives inside the polling effect below,
  // whose dep array is empty, so it closes over the first render forever — a
  // state dep would rebuild the 60s interval on every poll. Seeded from
  // serverNow because at t=0 the times on screen came from that server render.
  const lastGoodRef = useRef<string>(serverNow);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/ferry/status");
        if (!res.ok) {
          // E13: a 5xx is a RESOLVED fetch. The bare `return` that used to live
          // here left the board looking live through a server outage.
          // "unavailable", not "offline": this fires for our own broken server
          // as readily as for the worker's 503.
          if (!cancelled) setStale({ at: lastGoodRef.current, reason: "unavailable" });
          return;
        }
        // E13: a service-worker cache hit also resolves with res.ok === true, so
        // the catch never fires and this header is the only signal the bytes are
        // old. No header means genuinely fresh — no SW, an unsupported browser,
        // or a dev build must not be made to look like a failure.
        const fetchedAt = res.headers.get("X-SW-Fetched-At");
        const next = (await res.json()) as FerryStatusPayload;
        if (!cancelled) {
          setData(next);
          // Date the footer's "Updated …" from the cache stamp when there is one;
          // saying "Updated <now>" over week-old cached bytes is the dishonesty
          // this epic exists to remove.
          setUpdatedAt(fetchedAt ?? new Date().toISOString());
          setNow(Date.now());
          if (fetchedAt) {
            setStale({ at: fetchedAt, reason: "offline" });
          } else {
            lastGoodRef.current = new Date().toISOString();
            setStale(null);
          }
        }
      } catch {
        // Network hiccup — keep showing the last good data, but date it.
        if (!cancelled) setStale({ at: lastGoodRef.current, reason: "offline" });
      }
    }

    function stopPolling() {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    function startPolling() {
      stopPolling();
      pollRef.current = setInterval(refresh, POLL_MS);
    }
    function onVisibility() {
      if (document.hidden) {
        stopPolling();
      } else {
        refresh();
        startPolling();
      }
    }

    setNow(Date.now());
    startPolling();
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stopPolling();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Alerts that appeared after the page loaded (the page renders the initial
  // ones as a banner up top — don't repeat those here).
  const newAlerts = data.alerts.filter((a) => !initial.alerts.includes(a));

  const carToEdmonds = upcoming(data.carFerry.sailings, "from-kingston", now);
  const carToKingston = upcoming(data.carFerry.sailings, "to-kingston", now);
  const fastToSeattle = upcoming(data.fastFerry.sailings, "from-kingston", now);
  const fastToKingston = upcoming(data.fastFerry.sailings, "to-kingston", now);
  const fastRunsToday = data.fastFerry.sailings.length > 0;

  return (
    <div className="space-y-5">
      {/* E13 transport freshness — "how old is this copy of the board?", which is
          a different question from the per-card "Schedule times — not live"
          notes ("is the WSDOT feed live?"). Both can legitimately show at once
          offline. It leads the board on purpose: it frames every time below it,
          and the reader must meet it well before the footer. */}
      {stale && (
        <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {stale.reason === "offline"
            ? `Offline — saved times as of ${savedAtLabel(stale.at, now)}.`
            : `Can’t reach live times — saved times as of ${savedAtLabel(stale.at, now)}.`}{" "}
          Not live; confirm at{" "}
          <ExternalLink href="https://wsdot.wa.gov/travel/washington-state-ferries">
            wsdot.wa.gov/ferries
          </ExternalLink>
          {/* Only the offline wording may promise that going back online fixes
              it — when it's our server that's down, it won't. */}
          {stale.reason === "offline" ? " when you’re back online." : "."}
        </p>
      )}

      {newAlerts.length > 0 && (
        <div className="rounded-xl border-l-4 border-coral bg-coral/5 p-4">
          <p className="font-semibold text-sound-deep">New WSF alert since you opened this page</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {newAlerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-sound-deep">Edmonds–Kingston car ferry</h3>
          {data.carFerry.live ? (
            <Badge tone="green">Live</Badge>
          ) : (
            <Badge tone="coral">Schedule only</Badge>
          )}
        </div>
        {/* The DEPARTING side leads and is the only column with a TerminalNote
            (drive-up spaces + wait) — the terminal you'd actually be waiting at.
            Kingston side → "Kingston to Edmonds" leads with the Kingston terminal
            note; Edmonds side → "Edmonds to Kingston" leads with the Edmonds
            terminal note. */}
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          {(() => {
            const kingstonToEdmonds = (
              <DirectionColumn
                key="kingston-to-edmonds"
                label="Kingston to Edmonds"
                sailings={carToEdmonds}
                now={now}
                emptyNote="Done for today — first boat tomorrow morning."
                footer={
                  side === "kingston" ? (
                    <TerminalNote status={data.terminals.kingston} />
                  ) : undefined
                }
              />
            );
            const edmondsToKingston = (
              <DirectionColumn
                key="edmonds-to-kingston"
                label="Edmonds to Kingston"
                sailings={carToKingston}
                now={now}
                emptyNote="Done for today — first boat tomorrow morning."
                footer={
                  side === "edmonds" ? (
                    <TerminalNote status={data.terminals.edmonds} />
                  ) : undefined
                }
              />
            );
            return side === "edmonds"
              ? [edmondsToKingston, kingstonToEdmonds]
              : [kingstonToEdmonds, edmondsToKingston];
          })()}
        </div>
        {!data.carFerry.live && (
          <p className="mt-4 text-sm text-ink-soft">
            Schedule times — not live. Confirm at{" "}
            <ExternalLink href="https://wsdot.wa.gov/travel/washington-state-ferries">
              wsdot.wa.gov/ferries
            </ExternalLink>
            .
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-sound-deep">
            Kingston–Seattle fast ferry (passengers only)
          </h3>
          <Badge tone="sand">Published schedule</Badge>
        </div>
        {fastRunsToday ? (
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <DirectionColumn
              label="Kingston to Seattle (Pier 50)"
              sailings={fastToSeattle}
              now={now}
              emptyNote="Done for today."
            />
            <DirectionColumn
              label="Seattle (Pier 50) to Kingston"
              sailings={fastToKingston}
              now={now}
              emptyNote="Done for today."
            />
          </div>
        ) : (
          <p className="mt-4 text-ink-soft">
            No fast-ferry sailings today. There is no Sunday service, and Saturday boats run only
            in summer (roughly May–September). The car ferry runs every day.
          </p>
        )}
        <p className="mt-4 text-sm text-ink-soft">
          Schedule times — not live. Watch the boat on the{" "}
          <ExternalLink href="https://kttracker.com/map?routes=401,404">live tracker</ExternalLink>{" "}
          or confirm on{" "}
          <ExternalLink href="https://www.kitsaptransit.com/service/fast-ferry/kingston-fast-ferry">
            Kitsap Transit&rsquo;s schedule
          </ExternalLink>
          .
        </p>
      </Card>

      <details className="rounded-2xl border border-sand bg-white px-5 py-4">
        <summary className="cursor-pointer font-semibold text-sound-deep">
          All remaining sailings today
        </summary>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <RemainingList label="Car ferry: Kingston to Edmonds" sailings={carToEdmonds} />
          <RemainingList label="Car ferry: Edmonds to Kingston" sailings={carToKingston} />
          <RemainingList label="Fast ferry: Kingston to Seattle" sailings={fastToSeattle} />
          <RemainingList label="Fast ferry: Seattle to Kingston" sailings={fastToKingston} />
        </div>
      </details>

      <p className="text-xs text-ink">
        {data.carFerry.live
          ? "Car-ferry times are live from WSDOT."
          : "Car-ferry times are from the printed seasonal schedule — the live feed is unreachable right now."}
        {updatedAt ? ` Updated ${formatPacificTime(updatedAt)}.` : ""} Refreshes every minute
        while this page is open.
      </p>
    </div>
  );
}
