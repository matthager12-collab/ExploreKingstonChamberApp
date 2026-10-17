"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardingPassStatus } from "@/lib/wsf";
import type { WaterSide } from "@/lib/side";
import { useWakeRefresh } from "@/lib/ferry-refresh";
import { formatPacificDate, formatPacificTime, pacificDay } from "@/lib/time";
import { ferryLineNavUrl, lineBacksPastBarberCutoff } from "@/lib/ferry-line";
import { mapDirectionsUrl } from "@/components/ui";

/** Prominent status, using the existing effective verdict rather than a second rule. */
export function BoardingPassStatusCard({ initial, checkedAt, side, waitEstimate, navigation }: {
  initial: BoardingPassStatus | null;
  checkedAt: string;
  side: WaterSide;
  waitEstimate?: string;
  navigation?: { pass: string; terminal: string };
}) {
  const [snapshot, setSnapshot] = useState({ pass: initial, at: checkedAt, waitEstimate });
  const [now, setNow] = useState(() => Date.parse(checkedAt));
  const [unavailable, setUnavailable] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useWakeRefresh(() => refreshRef.current());

  useEffect(() => {
    if (side !== "kingston") return;
    let cancelled = false;
    let inFlight = false;
    let currentRequest: AbortController | undefined;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      setRefreshing(true);
      const controller = new AbortController();
      currentRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch("/api/ferry/status", { signal: controller.signal });
        if (!res.ok) throw new Error("Status unavailable");
        const next = await res.json();
        const pass = next.boardingPass as BoardingPassStatus | undefined;
        if (!pass || typeof pass.active !== "boolean" || typeof next.generatedAt !== "string" ||
            !["estimate", "override"].includes(pass.source) ||
            typeof pass.reason !== "string" || !Number.isFinite(Date.parse(next.generatedAt))) {
          throw new Error("Status unavailable");
        }
        if (!cancelled) {
          const savedAt = res.headers.get("X-SW-Fetched-At");
          if (savedAt && !Number.isFinite(Date.parse(savedAt))) throw new Error("Status unavailable");
          const wait = next.terminals?.kingston?.waitEstimate;
          setSnapshot({ pass, at: savedAt ?? next.generatedAt, waitEstimate: typeof wait === "string" ? wait : undefined });
          setUnavailable(Boolean(savedAt));
          setNow(Date.now());
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!cancelled) setRefreshing(false);
      }
    }
    function wake() {
      if (!document.hidden) refresh();
    }
    refreshRef.current = refresh;
    const firstCheck = setTimeout(() => {
      setNow(Date.now());
      refresh();
    }, 0);
    const poll = setInterval(wake, 60_000);
    const clock = setInterval(() => setNow(Date.now()), 10_000);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      currentRequest?.abort();
      clearTimeout(firstCheck);
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", wake);
      refreshRef.current = () => {};
    };
  }, [side]);

  const pass = snapshot.pass;
  const stale = unavailable || !pass || now - Date.parse(snapshot.at) > 120_000 ||
    pacificDay(snapshot.at) !== pacificDay(now);
  const edmonds = side === "edmonds";
  const headline = edmonds ? "Not needed at Edmonds" : stale ? "Current status unavailable" :
    pass.source === "override" ? (pass.active ? "Required now" : "Not required now") :
    (pass.active ? "Likely required now" : "Usually not required now");
  const longWait = lineBacksPastBarberCutoff(snapshot.waitEstimate);
  const directions = stale ? "/ferry#ferry-line-map" : pass?.active
    ? ferryLineNavUrl(longWait)
    : mapDirectionsUrl("Kingston Ferry Terminal, Kingston, WA 98346", "driving");

  return (
    <section aria-label="Vehicle boarding-pass status" className="mt-4 rounded-2xl bg-sound-deep p-5 text-white sm:p-6">
      <p className="text-sm font-semibold text-seaglass">Vehicle boarding passes · {edmonds ? "Edmonds" : "Kingston"} departures</p>
      <h2 aria-live="polite" aria-atomic="true" className="mt-1 text-2xl font-semibold sm:text-3xl">{headline}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed">
        {edmonds ? "Kingston’s SR 104 pass applies only to vehicles boarding in Kingston." :
          stale ? "We couldn’t check the current requirement. Refresh the status or follow the flashing signs at Barber Cutoff Road." :
          pass.source === "override" ? "Set by Chamber staff for today." :
          "Schedule estimate, not a live confirmation. Follow the flashing signs at Barber Cutoff Road."}
      </p>
      {!edmonds && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <a href={directions} target={stale ? undefined : "_blank"} rel={stale ? undefined : "noopener noreferrer"}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white bg-coral px-5 py-2.5 text-sm font-semibold text-white hover:bg-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            {stale ? "See the ferry-line map" : pass?.active ? (navigation?.pass ?? "Get in the vehicle ferry line") : (navigation?.terminal ?? "Navigate to the ferry")}
          </a>
          {!stale && pass?.active && <p className="max-w-2xl text-sm text-seaglass">
            {longWait ? "Directions go via Miller Bay Road because the line is beyond Barber Cutoff Road. Don’t U-turn early." :
              "Directions go via Barber Cutoff Road to the back of the line. Don’t U-turn early."}
          </p>}
        </div>
      )}
      {!edmonds && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-seaglass">{stale ? "Last checked" : "Checked"} {formatPacificDate(snapshot.at)}, {formatPacificTime(snapshot.at)} Pacific</p>
          <button type="button" onClick={() => refreshRef.current()} aria-disabled={refreshing} aria-busy={refreshing}
            className="min-h-11 rounded-lg border border-white px-3 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white aria-disabled:opacity-70">
            {refreshing ? "Checking…" : "Refresh status"}
          </button>
        </div>
      )}
    </section>
  );
}
