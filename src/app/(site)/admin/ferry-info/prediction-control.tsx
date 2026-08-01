"use client";

// Ferry busyness PREDICTION controls for /admin/ferry-info:
//   1. A show/hide switch — whether visitors see the planner, the "how busy
//      today" panel, and the home callout. Ships OFF so the Chamber can validate
//      first, then flip it on.
//   2. An accuracy panel — the latest backtest (heuristic prediction vs. the
//      fullness we've actually logged), a plain-English verdict on whether it's
//      good enough to show, a day-by-day trend chart, and a "run now" button.
//
// Authorization is server-side (/api/admin/ferry-prediction and
// /api/admin/ferry-accuracy both require role admin). Plain fetch + local state,
// like the sibling boarding-pass control.

import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import { accuracyVerdict, type VerdictTone } from "@/lib/ferry-accuracy-verdict";
import type { DailyAccuracyPoint } from "@/lib/stores/ferry-observations";
import { AccuracyTrend } from "./accuracy-trend";

interface Setting {
  enabled: boolean;
  setAt: string;
  setBy: string;
}
interface AccuracyMetrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  levelMatchRate: number;
  within1Rate: number;
  spanDays: number;
  computedAt: string;
}
export interface PredictionState {
  enabled: boolean;
  setting: Setting | null;
  accuracy: { latest: AccuracyMetrics | null; history: AccuracyMetrics[] };
  /** Per-day series behind the trend chart, oldest first. */
  daily: DailyAccuracyPoint[];
}

// Verdict tone → Badge tone. Kept here so the verdict module stays UI-free.
// The Badge palette has no amber, so "borderline" takes the solid navy (a
// definite state, not an alarm) and coral — the app's warning affordance — is
// reserved for the one verdict that calls for action.
const VERDICT_BADGE = {
  ready: "green",
  borderline: "navy",
  "not-ready": "coral",
  unknown: "sand",
} as const satisfies Record<VerdictTone, "green" | "navy" | "coral" | "sand">;

const btn = "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-100";

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

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function FerryPredictionControl({ initial }: { initial: PredictionState }) {
  const [state, setState] = useState<PredictionState>(initial);
  const [busy, setBusy] = useState<null | "on" | "off" | "run">(null);
  const [error, setError] = useState<string | null>(null);

  const { enabled, setting, accuracy, daily } = state;

  async function setEnabled(next: boolean) {
    setBusy(next ? "on" : "off");
    setError(null);
    try {
      const res = await fetch("/api/admin/ferry-prediction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | { ok: true; enabled: boolean; setting: Setting | null }
        | { error?: string };
      if (!res.ok || !("enabled" in data)) {
        setError(("error" in data && data.error) || "Something went wrong");
        return;
      }
      setState((s) => ({ ...s, enabled: data.enabled, setting: data.setting }));
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  async function runAccuracy() {
    setBusy("run");
    setError(null);
    try {
      const res = await fetch("/api/admin/ferry-accuracy", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as
        | {
            ok: true;
            latest: AccuracyMetrics | null;
            history: AccuracyMetrics[];
            daily: DailyAccuracyPoint[];
          }
        | { error?: string };
      if (!res.ok || !("latest" in data)) {
        setError(("error" in data && data.error) || "Something went wrong");
        return;
      }
      setState((s) => ({
        ...s,
        accuracy: { latest: data.latest, history: data.history },
        // Older deploys of the route didn't return `daily`; keep what we have
        // rather than blanking the chart on an unexpected shape.
        daily: data.daily ?? s.daily,
      }));
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  const a = accuracy.latest;
  const verdict = accuracyVerdict(a, daily);

  return (
    <Card className="mb-6 border-tide/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
            📈 Ferry busyness prediction
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Controls whether visitors see the busyness estimate — the planner at{" "}
            <code>/ferry/plan</code>, the &ldquo;how busy today&rdquo; panel on the Ferry page, and
            the home callout. While it&rsquo;s off, only signed-in admins can preview it.
          </p>
        </div>
        <Badge tone={enabled ? "green" : "sand"}>{enabled ? "Live to visitors" : "Hidden"}</Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEnabled(true)}
          disabled={busy !== null || enabled}
          className={`${btn} ${
            // Contrast: the inactive fill was bg-fern/90 → #5c896a, where white
            // text is 4.00:1. Solid fern is 4.86:1 and the ring still marks
            // which state is active.
            enabled
              ? "bg-fern text-white ring-2 ring-fern ring-offset-1"
              : "bg-fern text-white hover:ring-2 hover:ring-fern hover:ring-offset-1"
          }`}
        >
          {busy === "on" ? "Saving…" : enabled ? "✓ Shown to visitors" : "Show to visitors"}
        </button>
        <button
          type="button"
          onClick={() => setEnabled(false)}
          disabled={busy !== null || !enabled}
          className={`${btn} ${
            !enabled ? "bg-sound text-white ring-2 ring-sound ring-offset-1" : "border border-sand bg-white text-ink hover:border-tide"
          }`}
        >
          {busy === "off" ? "Saving…" : !enabled ? "✓ Hidden" : "Hide from visitors"}
        </button>
      </div>
      {setting && (
        <p className="mt-2 text-xs text-ink-soft">
          {enabled ? "Turned on" : "Turned off"} by {setting.setBy}
          {fmtWhen(setting.setAt) ? ` · ${fmtWhen(setting.setAt)}` : ""}.
        </p>
      )}
      <p className="mt-2 text-xs">
        <a
          href="/ferry/plan"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2"
        >
          Preview the planner →
        </a>{" "}
        <span className="text-ink-soft">— admins can open it even while it&rsquo;s hidden.</span>
      </p>

      {/* Accuracy panel — the validation signal */}
      <div className="mt-5 border-t border-sand pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-sound-deep">How accurate is it so far?</p>
          <button
            type="button"
            onClick={runAccuracy}
            disabled={busy !== null}
            className={`${btn} border border-sand bg-white text-tide-deep hover:border-tide disabled:opacity-50`}
          >
            {busy === "run" ? "Testing…" : "Run test now"}
          </button>
        </div>

        {a && a.n > 0 ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Avg error" value={`${a.mae} pts`} hint="of 100" />
              <Metric label="Right level" value={pct(a.levelMatchRate)} hint={`${pct(a.within1Rate)} within one`} />
              <Metric label="Bias" value={`${a.bias > 0 ? "+" : ""}${a.bias}`} hint={a.bias > 0 ? "runs high" : a.bias < 0 ? "runs low" : "even"} />
              <Metric label="Sample" value={`${a.n}`} hint={`over ${a.spanDays} day${a.spanDays === 1 ? "" : "s"}`} />
            </div>

            {/* The go/no-go read. The four tiles above are the evidence; this is
                what they mean for the decision this page exists to support. */}
            <div className="mt-4 rounded-xl border border-sand bg-sand/25 px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={VERDICT_BADGE[verdict.tone]}>{verdict.headline}</Badge>
              </p>
              <p className="mt-2 text-sm text-ink">{verdict.detail}</p>
            </div>

            <p className="mt-5 font-semibold text-sound-deep">Accuracy day by day</p>
            <p className="mt-1 text-sm text-ink-soft">
              The headline figures above are running totals across every sailing ever logged, so
              they barely move once the sample is large. This chart splits them out by day, so a
              change in the model — or a stretch of unusual traffic — actually shows up.
            </p>
            <AccuracyTrend series={daily} />

            <p className="mt-3 text-xs text-ink-soft">Last run {fmtWhen(a.computedAt)}.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            No accuracy data yet — the model needs logged sailings to grade itself against. The daily
            cron fills this in as observations accumulate; or hit &ldquo;Run test now&rdquo; once
            some are logged.
          </p>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-coral-deep">{error}</p>}
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-sand/40 px-3 py-2">
      <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-sound-deep tabular-nums">{value}</p>
      <p className="text-xs text-ink-soft">{hint}</p>
    </div>
  );
}
