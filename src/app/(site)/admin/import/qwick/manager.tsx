"use client";

// Client half of /admin/import/qwick: paste/upload a saved Qwick export,
// preview the bucketed plan, apply behind an explicit confirmation, and read
// the run history. Deliberately plain (fetch + local state) in the same
// spirit as admin/accounts/manager.tsx. All authorization is server-side —
// this UI talks only to /api/admin/import/qwick (admin-gated).
//
// TWO HARD RULES this file must keep:
//  - Vendor image URLs (the `sourceImages` provenance field) are NEVER
//    rendered — not in diffs, not in created rows. A CI guard test greps
//    src/app for the vendor's image host, so even the hostname may not
//    appear in this tree. We show the FIELD NAME only.
//  - Apply re-submits the SAME export payload; the server re-plans from it.
//    If the textarea changes after a preview, Apply locks until the operator
//    previews again.

import { useState, type ChangeEvent, type ReactNode } from "react";
import { Badge, Callout, Card, Section } from "@/components/ui";

/* ----------------------------- API shapes ----------------------------- */

interface FieldDiff {
  field: string;
  local: unknown;
  upstream: unknown;
}

interface CreatedEntry {
  externalId: string;
  record: {
    id: string;
    name: string;
    category: string;
    description?: string;
    phone?: string;
    website?: string;
    sourceCategories?: string[];
    sourceImages?: unknown;
  };
}

interface UpdatedEntry {
  externalId: string;
  store: string;
  id: string;
  status: string;
  diffs: FieldDiff[];
}

interface UnchangedEntry {
  externalId: string;
  store: string;
  id: string;
}

interface MatchedEntry {
  externalId: string;
  store: string;
  id: string;
  name: string;
  aliasNew: boolean;
  diffs: FieldDiff[];
}

interface QuarantinedEntry {
  externalId?: string;
  name?: string;
  reason: string;
  candidateIds?: string[];
}

interface Plan {
  created: CreatedEntry[];
  updated: UpdatedEntry[];
  unchanged: UnchangedEntry[];
  matched: MatchedEntry[];
  quarantined: QuarantinedEntry[];
  deletedUpstream: UnchangedEntry[];
}

type Stats = Record<string, number>;

interface RunRow {
  id: string;
  mode: "dry_run" | "apply";
  startedAt: string;
  finishedAt: string | null;
  runBy: string;
  stats: Stats;
}

interface PreviewResult {
  runId: string;
  stats: Stats;
  plan: Plan;
  /** The exact textarea contents the preview was computed from — Apply is
   *  only offered while the textarea still matches. */
  sourceText: string;
}

/* ------------------------------ helpers ------------------------------- */

const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const dangerButtonClass =
  "rounded-full bg-coral-deep px-6 py-2.5 font-semibold text-white hover:bg-coral disabled:opacity-50";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Render a diff value as text. `sourceImages` is provenance-only vendor
 *  image URLs and must never be shown — name the field, hide the value. */
function fmtValue(field: string, v: unknown): string {
  if (field === "sourceImages") return "(vendor image reference — value never shown)";
  if (v === undefined || v === null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === "") return "—";
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

function statsSummary(stats: Stats): string {
  const parts = [
    ["created", stats.created],
    ["updated", stats.updated],
    ["unchanged", stats.unchanged],
    ["matched", stats.matched],
    ["quarantined", stats.quarantined],
    ["deleted upstream", stats.deletedUpstream],
  ] as const;
  return parts
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([label, n]) => `${n} ${label}`)
    .join(" · ") || "nothing to do";
}

function DiffTable({ diffs }: { diffs: FieldDiff[] }) {
  if (diffs.length === 0) return <p className="text-xs text-ink-soft">No field differences.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="mt-1 w-full min-w-md text-left text-xs">
        <thead>
          <tr className="border-b border-sand text-ink-soft">
            <th scope="col" className="py-1 pr-3 font-semibold">
              Field
            </th>
            <th scope="col" className="py-1 pr-3 font-semibold">
              Ours
            </th>
            <th scope="col" className="py-1 font-semibold">
              Upstream
            </th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((d) => (
            <tr key={d.field} className="border-b border-sand/60 align-top">
              <td className="py-1 pr-3 font-medium whitespace-nowrap text-ink">{d.field}</td>
              <td className="py-1 pr-3 break-words text-ink">{fmtValue(d.field, d.local)}</td>
              <td className="py-1 break-words text-ink">{fmtValue(d.field, d.upstream)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bucket({
  title,
  count,
  explainer,
  children,
}: {
  title: string;
  count: number;
  explainer: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-xl border border-sand bg-white" open={count > 0 && count <= 8}>
      <summary className="cursor-pointer px-4 py-3 font-semibold text-sound-deep">
        {title} ({count})
        <span className="ml-2 text-xs font-normal text-ink-soft">{explainer}</span>
      </summary>
      <div className="border-t border-sand px-4 py-3">
        {count === 0 ? <p className="text-sm text-ink-soft">None.</p> : children}
      </div>
    </details>
  );
}

/* ------------------------------- manager ------------------------------- */

export function QwickImportManager({ initialRuns }: { initialRuns: RunRow[] }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [applied, setApplied] = useState<{ runId: string; stats: Stats } | null>(null);
  // Server-rendered on load (page.tsx); refreshed here after each run.
  const [runs, setRuns] = useState<RunRow[]>(initialRuns);
  const [runsError, setRunsError] = useState<string | null>(null);

  async function refreshRuns() {
    try {
      const res = await fetch("/api/admin/import/qwick");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { runs: RunRow[] };
      setRuns(json.runs);
      setRunsError(null);
    } catch {
      setRunsError("Could not refresh the import history — reload the page.");
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setFileName(file.name);
    setError(null);
  }

  /** Parse the textarea. Empty → undefined (the live-fetch fallback);
   *  invalid JSON → null (blocks the request with a local message). */
  function parseExport(): { export?: unknown } | null {
    const trimmed = text.trim();
    if (trimmed === "") return {};
    try {
      return { export: JSON.parse(trimmed) as unknown };
    } catch {
      setError(
        "That isn't valid JSON. Paste the saved export exactly as it was captured — either the raw GraphQL response or a bare array of listing rows.",
      );
      return null;
    }
  }

  async function submit(mode: "preview" | "apply") {
    const parsed = parseExport();
    if (parsed === null) return;
    setBusy(mode);
    setError(null);
    if (mode === "preview") {
      setApplied(null);
      setConfirmed(false);
    }
    try {
      const res = await fetch("/api/admin/import/qwick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, ...parsed }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : `Request failed (HTTP ${res.status}).`);
        return;
      }
      if (mode === "preview") {
        setPreview({
          runId: json.runId as string,
          stats: json.stats as Stats,
          plan: json.plan as Plan,
          sourceText: text,
        });
      } else {
        setApplied({ runId: json.runId as string, stats: json.stats as Stats });
        setConfirmed(false);
      }
      void refreshRuns();
    } catch {
      setError("The request failed — check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const plan = preview?.plan;
  const previewStale = preview !== null && preview.sourceText !== text;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 pb-12">
      <Callout title="The Qwick vendor is offline (since 2026-08-01)" tone="coral">
        <p>
          The kiosk vendor&apos;s API no longer resolves, so this screen works from a{" "}
          <strong>saved export</strong> — paste it below or upload the file. Options for
          recovering an export (the kiosk PC&apos;s browser cache, other chambers on the same
          platform) are in <code>docs/QWICK-DECOMMISSION.md</code> in the repository. Leaving
          the box empty makes Preview try the live API anyway, in case the vendor ever comes
          back.
        </p>
      </Callout>

      <Section title="1 · Provide the export">
        <Card>
          <label htmlFor="qwick-export" className="block text-sm font-medium text-ink">
            Saved export JSON — the raw GraphQL response or a bare array of listing rows
          </label>
          <textarea
            id="qwick-export"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
            }}
            rows={10}
            spellCheck={false}
            className="mt-2 block w-full rounded-lg border border-sand bg-white px-3 py-2 font-mono text-sm"
            placeholder='{"data":{"signByLicense":{"DataCollection":{"Data":[…]}}}} — or a bare [ … ] array'
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-full border border-sand bg-white px-5 py-2 text-sm font-semibold text-tide-deep hover:border-tide">
              Upload a .json file
              <input
                type="file"
                accept=".json,application/json"
                onChange={onFile}
                className="sr-only"
              />
            </label>
            {fileName && (
              <span className="text-xs text-ink-soft">
                Loaded <span className="font-medium text-ink">{fileName}</span> into the box above.
              </span>
            )}
          </div>
        </Card>
      </Section>

      <Section
        title="2 · Preview"
        subtitle="A preview writes nothing to any listing — it only records a dry-run report in the history below."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            disabled={busy !== null}
            onClick={() => void submit("preview")}
          >
            {busy === "preview" ? "Planning…" : "Preview import"}
          </button>
          {previewStale && (
            <p className="text-sm font-medium text-coral-deep">
              The export changed since this preview — run Preview again before applying.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-coral bg-coral/5 px-3 py-2 text-sm text-coral-deep">
            {error}
          </p>
        )}

        {plan && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-ink">
              <span className="font-semibold">Planned now:</span>{" "}
              {statsSummary(preview!.stats)}. Apply re-plans this same export against
              the database as it stands at that moment, so treat these as an estimate,
              not a promise.
            </p>

            <Bucket
              title="Will be created"
              count={plan.created.length}
              explainer="new invisible drafts in the directory"
            >
              <ul className="space-y-2">
                {plan.created.map((c) => (
                  <li key={c.externalId} className="text-sm">
                    <span className="font-medium text-ink">{c.record.name}</span>{" "}
                    <span className="text-xs text-ink-soft">
                      → directory/{c.record.id} · category {c.record.category}
                      {c.record.phone ? ` · ${c.record.phone}` : ""}
                      {c.record.website ? ` · ${c.record.website}` : ""}
                      {c.record.sourceImages != null
                        ? " · vendor images kept as provenance (never displayed)"
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Bucket>

            <Bucket
              title="Will be refreshed"
              count={plan.updated.length}
              explainer="records this importer created and no human has touched; status is preserved"
            >
              <ul className="space-y-3">
                {plan.updated.map((u) => (
                  <li key={u.externalId} className="text-sm">
                    <span className="font-medium text-ink">
                      {u.store}/{u.id}
                    </span>{" "}
                    <span className="text-xs text-ink-soft">stays {u.status}</span>
                    <DiffTable diffs={u.diffs} />
                  </li>
                ))}
              </ul>
            </Bucket>

            <Bucket
              title="Unchanged"
              count={plan.unchanged.length}
              explainer="already imported and identical upstream — nothing written"
            >
              <ul className="space-y-1">
                {plan.unchanged.map((u) => (
                  <li key={u.externalId} className="text-sm text-ink">
                    {u.store}/{u.id}
                  </li>
                ))}
              </ul>
            </Bucket>

            <Bucket
              title="Matched — local wins"
              count={plan.matched.length}
              explainer="curated, claimed, or admin-edited records the importer never writes; diffs are for hand-verification"
            >
              <ul className="space-y-3">
                {plan.matched.map((m) => (
                  <li key={m.externalId} className="text-sm">
                    <span className="font-medium text-ink">{m.name}</span>{" "}
                    <span className="text-xs text-ink-soft">
                      ({m.store}/{m.id}) ·{" "}
                      {m.aliasNew ? "apply will remember this match" : "match already remembered"}
                    </span>
                    <DiffTable diffs={m.diffs} />
                  </li>
                ))}
              </ul>
            </Bucket>

            <Bucket
              title="Quarantined"
              count={plan.quarantined.length}
              explainer="rows a human must resolve — an apply skips them entirely"
            >
              <ul className="space-y-2">
                {plan.quarantined.map((q, i) => (
                  <li key={q.externalId ?? `q-${i}`} className="text-sm">
                    <span className="font-medium text-ink">
                      {q.name ?? q.externalId ?? "(unidentified row)"}
                    </span>{" "}
                    <span className="text-xs text-coral-deep">{q.reason}</span>
                    {q.candidateIds && q.candidateIds.length > 0 && (
                      <span className="block text-xs text-ink-soft">
                        Could be: {q.candidateIds.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Bucket>

            <Bucket
              title="Deleted upstream"
              count={plan.deletedUpstream.length}
              explainer="gone from the export but kept locally — the importer never deletes"
            >
              <ul className="space-y-1">
                {plan.deletedUpstream.map((d) => (
                  <li key={d.externalId} className="text-sm text-ink">
                    {d.store}/{d.id}{" "}
                    <span className="text-xs text-ink-soft">(upstream id {d.externalId})</span>
                  </li>
                ))}
              </ul>
            </Bucket>
          </div>
        )}
      </Section>

      <Section
        title="3 · Apply"
        subtitle="Applies the SAME export you previewed. The server deliberately re-plans it from scratch against the database as it stands at that moment — it never replays the stored preview — so the counts that actually run can differ from the preview's. Created records land as invisible drafts; publishing stays a per-record decision on the listings screen."
      >
        {preview === null ? (
          // E14 contrast, fixed at the usage site: this paragraph is a direct
          // child of <Section>, so it sits on the page fill (--color-shell),
          // where --color-ink-soft measures 4.4993:1 — under AA 1.4.3. The same
          // token clears AA inside a Card (4.62:1 on white), which is why every
          // other muted note in this file may keep it. Full ink here (14.8:1);
          // no --color-* token VALUE changed. The zero-tolerance axe suite
          // cannot catch this pair — <body> carries a background-image, so axe
          // reports "incomplete" instead of a violation — so the guard is
          // tests/unit/qwick-import-ui.test.tsx, which measures the ratio.
          <p className="text-sm text-ink">Run a preview first — Apply unlocks after it.</p>
        ) : (
          <Card>
            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 accent-sound"
              />
              {/* Honest confirmation: the numbers below are the PREVIEW's, and
                  the server re-plans on apply (deliberately — it is what stops
                  a stale plan being replayed against a moved database). Saying
                  "write these numbers" would be a promise this screen cannot
                  keep, so the checkbox says what it really commits to and
                  points at the result panel as the authoritative count. */}
              <span>
                I have read the preview above and want to apply this export. The preview
                planned <span className="font-semibold">{statsSummary(preview.stats)}</span>,
                but the server re-plans from the export when Apply runs — if the database
                changed in between, the final counts will differ. What actually ran is
                reported below once it finishes, and that is the authoritative number.
                Nothing becomes public — created and refreshed records stay drafts.
              </span>
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={dangerButtonClass}
                disabled={!confirmed || previewStale || busy !== null}
                onClick={() => void submit("apply")}
              >
                {busy === "apply" ? "Applying…" : "Apply import"}
              </button>
              {previewStale && (
                <p className="text-sm font-medium text-coral-deep">
                  Locked: the export changed since the preview.
                </p>
              )}
            </div>
            {applied && (
              <p className="mt-4 rounded-lg border border-sand bg-shell px-3 py-2 text-sm text-ink">
                <span className="font-semibold">Applied — what actually ran:</span>{" "}
                {statsSummary(applied.stats)} — run {applied.runId.slice(0, 8)}. These are
                the authoritative counts from the server&apos;s re-plan; the preview&apos;s
                were only an estimate. Review the new drafts in the Directory tab of{" "}
                <a href="/admin/listings" className="font-medium text-tide-deep underline">
                  Listings
                </a>
                .
              </p>
            )}
          </Card>
        )}
      </Section>

      <Section
        title="Import history"
        subtitle="Every preview and apply, newest first. Record-level changes are also in the regular change history."
      >
        <Card>
          {runsError && <p className="text-sm text-coral-deep">{runsError}</p>}
          {runs.length === 0 && (
            <p className="text-sm text-ink-soft">No import runs recorded yet.</p>
          )}
          {runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-md text-left text-sm">
                <thead>
                  <tr className="border-b border-sand text-xs text-ink-soft">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      When
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Mode
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Run by
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-sand/60 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-ink">
                        {fmtWhen(r.startedAt)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={r.mode === "apply" ? "green" : "sand"}>
                          {r.mode === "apply" ? "Apply" : "Preview"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 break-all text-ink">{r.runBy}</td>
                      <td className="py-2 text-ink">{statsSummary(r.stats)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>
    </div>
  );
}
