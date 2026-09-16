"use client";

// The audit browser's client half (E09). Filter bar → GET /api/admin/audit;
// rows expand into the same DiffView the record-history panel uses; "pinned"
// mode (store + recordId both set) adds the provenance banner and per-row
// restore — that pinned view is the history surface for stores whose editors
// are frozen monoliths (map builder, parking zones).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Card } from "@/components/ui";
import {
  type AuditPage,
  ACTION_VERBS,
  actionTone,
  actionVerb,
  editorHref,
  fmtWhen,
  historyUrl,
} from "@/components/admin/audit-ui";
import { Provenance } from "@/components/admin/provenance";
import { DiffView, RestoreButton } from "@/components/admin/record-history";

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

export type BrowserFilters = {
  store?: string;
  recordId?: string;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
};

function toParams(filters: BrowserFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

/** API-call params: the date inputs give local calendar days, but the server
 *  pins date-only values to UTC days — 7-8h off for Kingston admins. Only
 *  the client knows the viewer's timezone, so convert here (form state and
 *  the URL keep the raw YYYY-MM-DD for shareable deep links). new Date with
 *  a time part and no Z parses as LOCAL time per ECMA-262. */
function toApiParams(filters: BrowserFilters): URLSearchParams {
  const params = toParams(filters);
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
    params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  }
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
    params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  }
  return params;
}

export function AuditBrowser({
  stores,
  initialFilters,
}: {
  stores: string[];
  initialFilters: BrowserFilters;
}) {
  const router = useRouter();
  const [form, setForm] = useState<BrowserFilters>(initialFilters);
  const [applied, setApplied] = useState<BrowserFilters>(initialFilters);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pinned = Boolean(applied.store && applied.recordId);
  // Request sequencing: a slow response for an older filter set (or an older
  // cursor page) must never overwrite — or append onto — a newer one.
  const seqRef = useRef(0);

  const load = useCallback(
    async (filters: BrowserFilters, cursor?: number) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = toApiParams(filters);
        if (cursor !== undefined) params.set("cursor", String(cursor));
        const res = await fetch(`/api/admin/audit?${params.toString()}`);
        if (seq !== seqRef.current) return; // superseded by a newer load
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as AuditPage;
        if (seq !== seqRef.current) return;
        setPage((prev) =>
          cursor !== undefined && prev
            ? { ...data, entries: [...prev.entries, ...data.entries] }
            : data,
        );
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "Couldn't load the trail");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Microtask boundary: no synchronous setState from an effect body.
    queueMicrotask(() => void load(applied));
  }, [applied, load]);

  const apply = (next: BrowserFilters) => {
    setApplied(next);
    setExpandedId(null);
    setNotice(null);
    router.replace(`/admin/audit?${toParams(next).toString()}`, { scroll: false });
  };

  const set = (key: keyof BrowserFilters) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value || undefined }));

  const csvHref = `/api/admin/audit?${(() => {
    const params = toApiParams(applied);
    params.set("format", "csv");
    return params.toString();
  })()}`;

  return (
    <div className="space-y-4">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(form);
          }}
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <label className="text-xs font-medium text-ink-soft">
            Content type
            <select
              className={`${INPUT} mt-1`}
              value={form.store ?? ""}
              onChange={(e) => set("store")(e.target.value)}
            >
              <option value="">All</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {form.store && !stores.includes(form.store) && (
                <option value={form.store}>{form.store}</option>
              )}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Record id
            <input
              className={`${INPUT} mt-1`}
              value={form.recordId ?? ""}
              onChange={(e) => set("recordId")(e.target.value)}
              placeholder="any"
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Who
            <input
              className={`${INPUT} mt-1`}
              value={form.actor ?? ""}
              onChange={(e) => set("actor")(e.target.value)}
              placeholder="email"
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Action
            <select
              className={`${INPUT} mt-1`}
              value={form.action ?? ""}
              onChange={(e) => set("action")(e.target.value)}
            >
              <option value="">All</option>
              {Object.keys(ACTION_VERBS).map((a) => (
                <option key={a} value={a}>
                  {actionVerb(a)}
                </option>
              ))}
              {form.action && !(form.action in ACTION_VERBS) && (
                <option value={form.action}>{form.action}</option>
              )}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            From
            <input
              type="date"
              className={`${INPUT} mt-1`}
              value={form.from ?? ""}
              onChange={(e) => set("from")(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            To
            <input
              type="date"
              className={`${INPUT} mt-1`}
              value={form.to ?? ""}
              onChange={(e) => set("to")(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-6">
            <button
              type="submit"
              className="rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white hover:bg-sound-deep"
            >
              Filter
            </button>
            <button
              type="button"
              onClick={() => {
                setForm({});
                apply({});
              }}
              className="rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-tide"
            >
              Reset
            </button>
            <a
              href={csvHref}
              className="ml-auto rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-tide-deep hover:border-tide"
            >
              Download CSV
            </a>
          </div>
        </form>
      </Card>

      {pinned && page && (
        <Card>
          <p className="mb-2 text-sm font-semibold text-sound-deep">
            History for <span className="font-mono">{applied.store}</span> ·{" "}
            <span className="font-mono">{applied.recordId}</span>
          </p>
          <Provenance
            key={`${applied.store}:${applied.recordId}`}
            store={applied.store!}
            recordId={applied.recordId!}
            meta={page.recordMeta ?? null}
          />
        </Card>
      )}

      {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
      {notice && <p role="status" className="text-sm font-medium text-fern">{notice}</p>}

      <Card>
        {page?.entries.length === 0 && !loading && (
          <p className="text-sm text-ink-soft">No changes match these filters.</p>
        )}
        <ul className="divide-y divide-sand">
          {page?.entries.map((entry) => {
            const expanded = expandedId === entry.id;
            const editor = editorHref(entry.store, entry.recordId);
            return (
              <li key={entry.id} className="py-2">
                <button
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  aria-expanded={expanded}
                  className="flex w-full flex-wrap items-center gap-2 text-left text-sm text-ink"
                >
                  <span className="text-xs whitespace-nowrap text-ink-soft">
                    {fmtWhen(entry.ts)}
                  </span>
                  <span className="font-medium">{entry.actor}</span>
                  <Badge tone={actionTone(entry.action)}>
                    {actionVerb(entry.action)}
                  </Badge>
                  <span className="text-xs text-ink-soft">
                    {entry.store} · <span className="font-mono">{entry.recordId}</span>
                  </span>
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2 border-t border-sand pt-2">
                    {entry.metadataOnly ? (
                      <p className="text-xs text-ink-soft">
                        Details are hidden for account security — this row
                        records only who did what, and when.
                      </p>
                    ) : (
                      <>
                        <DiffView entry={entry} />
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-tide-deep">
                            Raw JSON
                          </summary>
                          <pre className="mt-1 max-h-64 overflow-auto rounded bg-shell p-2 text-[0.6875rem] leading-snug">
                            {JSON.stringify(
                              { before: entry.before, after: entry.after },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      {pinned && !entry.metadataOnly && (
                        <RestoreButton
                          entry={entry}
                          recordMeta={page?.recordMeta ?? null}
                          onRestored={() => {
                            setNotice("Restored — saved as a new change.");
                            setExpandedId(null);
                            void load(applied);
                          }}
                          onError={(message) => setError(message)}
                        />
                      )}
                      {!pinned && (
                        <a
                          href={historyUrl(entry.store, entry.recordId)}
                          className="text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                        >
                          Pin this record&apos;s history
                        </a>
                      )}
                      {editor && (
                        <a
                          href={editor}
                          className="text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                        >
                          Open in its editor
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {loading && <p className="py-2 text-xs text-ink-soft">Loading…</p>}
        {page?.nextCursor != null && !loading && (
          <button
            onClick={() => void load(applied, page.nextCursor ?? undefined)}
            className="mt-2 rounded-full border border-sand bg-white px-4 py-1.5 text-xs font-semibold text-ink hover:border-tide"
          >
            Show older changes
          </button>
        )}
      </Card>
    </div>
  );
}
