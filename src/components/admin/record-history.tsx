"use client";

// E09 record-history panel: plain-language change rows for one record, an
// expandable field diff (computed client-side from the API's redacted
// snapshots via diffDocs), a lazy raw-JSON view, and "Restore this version".
//
// Restore always POSTs to /api/admin/audit/restore and the server decides
// everything (registry, action gate, concurrency, validation) — the
// `restorable` flag on each entry is the server's verdict, the client only
// renders it. Confirmation goes through window.confirm and the exact text
// also rides a data-confirm attribute so tests can assert the wording
// without stubbing (E08 worklist convention).
//
// Collapsed by default and fetches nothing until opened — editors mount one
// of these per selected record, and the content manager mounts one per copy
// block, so laziness is the difference between one fetch and eighty.
//
// MOUNT CONTRACT: any site where the selected record can CHANGE must pass
// key={`${store}:${recordId}`} (same for Provenance) — remount is what
// guarantees a switched record never shows the previous record's history or
// restore buttons, without render-time ref gymnastics.

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui";
import { diffDocs } from "@/lib/audit/diff";

import {
  type AuditEntryView,
  type AuditPage,
  type RecordMetaView,
  actionTone,
  actionVerb,
  fmtWhen,
  postRestore,
  restoreConfirmText,
} from "./audit-ui";

/** Client-side mirror of the full-snapshot action set — tooltip copy only;
 *  the server's `restorable` flag is what enables the button. */
const FULL_SNAPSHOT_ACTIONS = new Set([
  "create",
  "update",
  "delete",
  "import",
  "restore",
]);

function summarize(entry: AuditEntryView): string {
  if (entry.metadataOnly) return "";
  if (entry.action === "update" || entry.action === "restore") {
    const changes = diffDocs(entry.before, entry.after).filter(
      (d) => d.path !== "…",
    ).length;
    return ` · ${changes} field${changes === 1 ? "" : "s"} changed`;
  }
  return "";
}

function ValueCell({ value }: { value: unknown }) {
  const text =
    typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  return <span className="break-all whitespace-pre-wrap">{text}</span>;
}

export function DiffView({ entry }: { entry: AuditEntryView }) {
  const rows = diffDocs(entry.before, entry.after);
  if (rows.length === 0) {
    return <p className="text-xs text-ink-soft">No field changes recorded.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-ink-soft">
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Before</th>
            <th className="py-1 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.path} className="border-t border-sand align-top">
              <td className="py-1.5 pr-3 font-mono">{d.path}</td>
              <td
                className={`py-1.5 pr-3 ${d.kind === "added" ? "text-ink-soft" : "text-coral-deep"}`}
              >
                {d.kind === "added" ? "—" : <ValueCell value={d.from} />}
              </td>
              <td
                className={`py-1.5 ${d.kind === "removed" ? "text-ink-soft" : "text-fern"}`}
              >
                {d.kind === "removed" ? (
                  "—"
                ) : d.note ? (
                  d.note
                ) : (
                  <ValueCell value={d.to} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RestoreButton({
  entry,
  recordMeta,
  onRestored,
  onError,
}: {
  entry: AuditEntryView;
  recordMeta: RecordMetaView | null;
  onRestored: (meta: RecordMetaView | null) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!entry.restorable) {
    const reason = FULL_SNAPSHOT_ACTIONS.has(entry.action)
      ? "Restore isn't available for this content type yet"
      : "This entry doesn't contain a full version of the record";
    return (
      <button
        disabled
        title={reason}
        className="rounded-full border border-sand bg-shell px-4 py-1.5 text-xs font-semibold text-ink-soft"
      >
        Restore this version
      </button>
    );
  }

  const confirmText = restoreConfirmText(entry, recordMeta?.deleted ?? false);

  const restore = async () => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const result = await postRestore({
        store: entry.store,
        recordId: entry.recordId,
        auditId: entry.id,
        expectedUpdatedAt: recordMeta?.updatedAt ?? null,
      });
      if (result.ok) onRestored(result.recordMeta);
      else onError(result.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={() => void restore()}
      disabled={busy}
      data-confirm={confirmText}
      className="rounded-full border border-coral/40 bg-white px-4 py-1.5 text-xs font-semibold text-coral-deep hover:bg-coral/10 disabled:opacity-60"
    >
      {busy ? "Restoring…" : "Restore this version"}
    </button>
  );
}

export function RecordHistory({
  store,
  recordId,
  defaultOpen = false,
}: {
  store: string;
  recordId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  // Sequencing: only the newest request may commit — an older response (a
  // cursor page, or a fetch superseded by a restore refetch) must not
  // overwrite newer state. Cross-RECORD staleness is handled by remount:
  // every switching mount site passes key={`${store}:${recordId}`}, so a
  // record change unmounts this instance and in-flight responses die with it.
  const seqRef = useRef(0);

  const load = useCallback(
    async (cursor?: number) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ store, recordId });
        if (cursor !== undefined) params.set("cursor", String(cursor));
        const res = await fetch(`/api/admin/audit?${params.toString()}`);
        if (seq !== seqRef.current) return; // superseded
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
        setError(err instanceof Error ? err.message : "Couldn't load history");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [store, recordId],
  );

  useEffect(() => {
    if (!open || page || loading) return;
    // Microtask boundary: setState inside load() must not run synchronously
    // within the effect (react-hooks/set-state-in-effect).
    queueMicrotask(() => void load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page]);

  return (
    <div className="rounded-xl border border-sand bg-shell/40 p-3">
      <button
        onClick={() => {
          // Collapsing drops the page so every reopen refetches — the host
          // editor's own saves would otherwise leave this panel (and its
          // recordMeta.updatedAt restore pin) permanently stale.
          if (open) setPage(null);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="text-sm font-semibold text-tide-deep hover:text-sound"
      >
        {open ? "Hide change history" : "View change history"}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {error && <p role="alert" className="text-sm font-medium text-coral-deep">{error}</p>}
          {restored && (
            <p role="status" className="text-sm font-medium text-fern">
              Restored — saved as a new change.{" "}
              <button
                onClick={() => window.location.reload()}
                className="underline decoration-seaglass underline-offset-2"
              >
                Reload the page
              </button>{" "}
              to see it in the editor.
            </p>
          )}
          {page?.entries.length === 0 && (
            <p className="text-sm text-ink-soft">
              No changes recorded yet — this record is still exactly its
              original version.
            </p>
          )}

          <ul className="space-y-1.5">
            {page?.entries.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <li key={entry.id} className="rounded-lg bg-white px-3 py-2">
                  <button
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-2 text-left text-sm text-ink"
                  >
                    <span className="text-xs text-ink-soft">{fmtWhen(entry.ts)}</span>
                    <span className="font-medium">{entry.actor}</span>
                    <Badge tone={actionTone(entry.action)}>
                      {actionVerb(entry.action)}
                    </Badge>
                    <span className="text-xs text-ink-soft">{summarize(entry)}</span>
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
                          <RestoreButton
                            entry={entry}
                            recordMeta={page?.recordMeta ?? null}
                            onRestored={() => {
                              setRestored(true);
                              setError(null);
                              setPage(null);
                              setExpandedId(null);
                              void load();
                            }}
                            onError={(message) => setError(message)}
                          />
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {loading && <p className="text-xs text-ink-soft">Loading…</p>}
          {page?.nextCursor != null && !loading && (
            <button
              onClick={() => void load(page.nextCursor ?? undefined)}
              className="rounded-full border border-sand bg-white px-4 py-1.5 text-xs font-semibold text-ink hover:border-tide"
            >
              Show older changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
