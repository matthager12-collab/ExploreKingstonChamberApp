"use client";

// E12 events-sources manager: plain fetch + local state against
// /api/admin/events-sources, sibling-control conventions (ferry
// prediction-control is the model). Every mutation returns the refreshed
// snapshot, so the whole panel re-syncs on each action.

import { useState } from "react";
import { Badge, Card } from "@/components/ui";

interface FlagSetting {
  enabled: boolean;
  setAt: string;
  setBy: string;
}
interface SourceRecord {
  id: string;
  enabled: boolean;
  feedUrl?: string;
  lastRunAt?: string;
  lastRunReport?: {
    fetched: number;
    parsed: number;
    skipped: number;
    errors: string[];
    created?: number;
    updated?: number;
    removed?: number;
    unchanged?: number;
  };
}
interface OverrideRecord {
  id: string;
  keyA: string;
  keyB: string;
  setBy: string;
  setAt: string;
}
interface ClusterMember {
  title: string;
  startIso: string;
  venue: string;
  source: string;
  occurrenceKey: string;
}
interface Cluster {
  survivor: ClusterMember;
  members: ClusterMember[];
}
interface OrgRow {
  id: string;
  name: string;
  kind: string;
  trustedAutoPublish: boolean;
}
export interface EventsSourcesState {
  flag: { enabled: boolean; setting: FlagSetting | null };
  sources: SourceRecord[];
  overrides: OverrideRecord[];
  mergedCount: number;
  clusters: Cluster[];
  orgs: OrgRow[];
}

const SOURCE_LABELS: Record<string, string> = {
  "ams-ical": "Chamber GrowthZone calendar (transitional — ends ~April 2027)",
  "tribe-explorekingstonwa": "explorekingstonwa.com (Chamber WordPress — empty so far)",
  "tribe-portofkingston": "Port of Kingston (needs Chamber sign-off before enabling)",
};

const btn =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-60";

function fmtWhen(iso?: string): string {
  if (!iso) return "";
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

export function EventsSourcesManager({ initial }: { initial: EventsSourcesState }) {
  const [state, setState] = useState<EventsSourcesState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/events-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<EventsSourcesState> & {
        error?: string;
        perSource?: Record<string, { errors: string[] }>;
      };
      if (!res.ok || !("flag" in data)) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setState(data as EventsSourcesState);
      if (body.action === "sync-now" && data.perSource) {
        const errs = Object.values(data.perSource).flatMap((s) => s.errors);
        setNotice(errs.length ? `Sync finished with ${errs.length} note(s) — see last-run reports.` : "Sync finished clean.");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  const { flag, sources, overrides, clusters, orgs, mergedCount } = state;

  return (
    <div className="grid gap-6">
      {/* ---- ship-dark flag ---- */}
      <Card className="border-tide/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-sound-deep">📅 Unified calendar</p>
            <p className="mt-1 text-sm text-ink-soft">
              While OFF, visitors see exactly the hand-curated calendar they see today;
              ingest keeps running in the background. Flipping this ON in production is
              the launch-cutover call (E15) — coordinate before turning it on.
            </p>
          </div>
          <Badge tone={flag.enabled ? "green" : "sand"}>
            {flag.enabled ? "Live to visitors" : "Dark (in-app only)"}
          </Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || flag.enabled}
            onClick={() => act({ action: "set-flag", enabled: true }, "flag")}
            className={`${btn} bg-fern/90 text-white hover:bg-fern`}
          >
            {busy === "flag" ? "Saving…" : "Show merged calendar"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !flag.enabled}
            onClick={() => act({ action: "set-flag", enabled: false }, "flag")}
            className={`${btn} border border-sand bg-white text-ink hover:border-tide`}
          >
            Keep dark
          </button>
        </div>
        {flag.setting && (
          <p className="mt-2 text-xs text-ink-soft">
            Last changed by {flag.setting.setBy}
            {fmtWhen(flag.setting.setAt) ? ` · ${fmtWhen(flag.setting.setAt)}` : ""}.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          Merged calendar currently holds <span className="font-semibold">{mergedCount}</span>{" "}
          events across all enabled sources (in-app included).
        </p>
      </Card>

      {/* ---- sources ---- */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-semibold text-sound-deep">Ingest sources</p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act({ action: "sync-now" }, "sync")}
            className={`${btn} bg-sound text-white hover:bg-sound-deep`}
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {notice && <p className="mt-2 text-sm font-medium text-fern">{notice}</p>}
        <ul className="mt-4 grid gap-4">
          {sources.map((s) => (
            <li key={s.id} className="rounded-xl border border-sand p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sound-deep">
                    <code className="text-sm">{s.id}</code>
                  </p>
                  <p className="text-xs text-ink-soft">{SOURCE_LABELS[s.id] ?? ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={s.enabled ? "green" : "sand"}>
                    {s.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act({ action: "set-source", id: s.id, enabled: !s.enabled }, `src-${s.id}`)
                    }
                    className={`${btn} border border-sand bg-white text-ink hover:border-tide`}
                  >
                    {busy === `src-${s.id}` ? "Saving…" : s.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
              {s.lastRunReport ? (
                <p className="mt-2 text-xs text-ink-soft">
                  Last run {fmtWhen(s.lastRunAt)} — fetched {s.lastRunReport.fetched}, parsed{" "}
                  {s.lastRunReport.parsed}, skipped {s.lastRunReport.skipped}
                  {typeof s.lastRunReport.created === "number" && (
                    <>
                      {" "}
                      · +{s.lastRunReport.created} / ~{s.lastRunReport.updated} / −
                      {s.lastRunReport.removed} (unchanged {s.lastRunReport.unchanged})
                    </>
                  )}
                  {s.lastRunReport.errors.length > 0 && (
                    <span className="mt-1 block text-coral-deep">
                      {s.lastRunReport.errors.slice(0, 3).map((e) => (
                        <span key={e} className="block">
                          ⚠ {e}
                        </span>
                      ))}
                      {s.lastRunReport.errors.length > 3 &&
                        ` …and ${s.lastRunReport.errors.length - 3} more`}
                    </span>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-xs text-ink-soft">Never run.</p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* ---- dedupe review ---- */}
      <Card>
        <p className="text-lg font-semibold text-sound-deep">Possible duplicates</p>
        <p className="mt-1 text-sm text-ink-soft">
          Events merged into one calendar entry. If two of these are actually different
          events, mark them &ldquo;not a duplicate&rdquo; and they&rsquo;ll both show.
        </p>
        {clusters.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No merged clusters right now.</p>
        ) : (
          <ul className="mt-4 grid gap-4">
            {clusters.map((c) => (
              <li key={c.survivor.occurrenceKey} className="rounded-xl border border-sand p-4">
                <p className="font-semibold text-sound-deep">{c.survivor.title}</p>
                <ul className="mt-2 grid gap-2">
                  {c.members.map((m) => (
                    <li
                      key={m.occurrenceKey}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0">
                        <Badge tone={m.source === "in-app" ? "teal" : "sand"}>{m.source}</Badge>{" "}
                        {m.title}
                        {m.venue ? ` — ${m.venue}` : ""}{" "}
                        <span className="text-xs text-ink-soft">{fmtWhen(m.startIso)}</span>
                      </span>
                      {m.occurrenceKey !== c.survivor.occurrenceKey && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              {
                                action: "not-duplicate",
                                keyA: c.survivor.occurrenceKey,
                                keyB: m.occurrenceKey,
                              },
                              `split-${m.occurrenceKey}`,
                            )
                          }
                          className={`${btn} border border-sand bg-white text-xs text-ink hover:border-tide`}
                        >
                          {busy === `split-${m.occurrenceKey}` ? "Saving…" : "Not a duplicate"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {overrides.length > 0 && (
          <div className="mt-4 border-t border-sand pt-3">
            <p className="text-sm font-semibold text-sound-deep">Recorded verdicts</p>
            <ul className="mt-2 grid gap-1">
              {overrides.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 text-xs text-ink-soft">
                  <span className="min-w-0 truncate">
                    {o.keyA} ≠ {o.keyB} · by {o.setBy}
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act({ action: "remove-override", id: o.id }, `rm-${o.id}`)}
                    className="font-medium text-coral-deep underline underline-offset-2"
                  >
                    undo
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ---- trusted orgs ---- */}
      <Card>
        <p className="text-lg font-semibold text-sound-deep">Trusted organizations</p>
        <p className="mt-1 text-sm text-ink-soft">
          A trusted organization&rsquo;s event submissions and edits publish immediately,
          skipping the review queue (they&rsquo;re still fully audited). Everyone else
          holds for review. Use sparingly — this is the only bypass there is.
        </p>
        {orgs.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No organizations yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {orgs.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sand px-4 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium text-sound-deep">{o.name}</span>{" "}
                  <span className="text-xs text-ink-soft">({o.kind})</span>
                </span>
                <div className="flex items-center gap-2">
                  <Badge tone={o.trustedAutoPublish ? "green" : "sand"}>
                    {o.trustedAutoPublish ? "Auto-publish" : "Holds for review"}
                  </Badge>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        { action: "set-trusted-org", orgId: o.id, trusted: !o.trustedAutoPublish },
                        `org-${o.id}`,
                      )
                    }
                    className={`${btn} border border-sand bg-white text-xs text-ink hover:border-tide`}
                  >
                    {busy === `org-${o.id}`
                      ? "Saving…"
                      : o.trustedAutoPublish
                        ? "Require review"
                        : "Trust"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && <p className="text-sm font-medium text-coral-deep">{error}</p>}
    </div>
  );
}
