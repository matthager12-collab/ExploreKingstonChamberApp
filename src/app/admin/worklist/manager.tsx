"use client";

// E08 worklist manager — phone-first queue UI. One column, big touch
// targets, ~10 seconds per item: tap a row to expand its detail panel, act
// with one confirm-gated tap. Destructive actions (approve = publish,
// reject, dismiss, takedown) go through window.confirm — the confirm text
// also rides a data-confirm attribute so the component test can assert the
// gate exists without simulating a browser dialog.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { attachmentKind, attachmentPublicUrl } from "@/lib/events/attachment-refs";
import type { WorklistState, WorklistType } from "@/lib/schemas/worklist";

export type WorklistItemView = {
  id: string;
  type: WorklistType;
  subjectStore: string;
  subjectId: string;
  subjectLabel: string;
  state: WorklistState;
  assigneeUserId: string | null;
  dueAt: string | null;
  payload: Record<string, unknown>;
  resolution: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Any-status snapshot of the subject record (null = record gone or the
   *  store isn't content-backed, e.g. hunt photos). */
  subject: Record<string, unknown> | null;
};

export type WorklistCounts = Record<WorklistType, Record<WorklistState, number>>;

/** E11 fulfillment controls for a privacy_request item. `access` exports the
 *  requester's data (downloaded client-side); `delete` runs the PII-inventory
 *  sweep behind a confirm and a legal-hold check; `records` is human-fulfilled
 *  (retention/legal-hold reconciliation off-app) so it only offers resolve. */
function PrivacyRequestTools({
  item,
  busy,
  note,
  actionBtn,
  onFulfill,
  onResolve,
}: {
  item: WorklistItemView;
  busy: boolean;
  note: string;
  actionBtn: string;
  onFulfill: (
    itemId: string,
    op: "access" | "delete" | "hold-set" | "hold-clear",
    opts?: { reason?: string; confirmText?: string },
  ) => void;
  onResolve: (resolution: string) => void;
}) {
  const kind = String(item.payload.requestKind ?? "");
  const resolved = item.state === "resolved" || item.state === "dismissed";
  if (resolved) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "access" && (
        <button
          className={`${actionBtn} bg-sound text-white hover:bg-sound-deep`}
          disabled={busy}
          onClick={() => onFulfill(item.id, "access")}
        >
          Run access export
        </button>
      )}
      {kind === "delete" && (
        <>
          <button
            className={`${actionBtn} bg-coral text-white hover:opacity-90`}
            disabled={busy}
            onClick={() =>
              onFulfill(item.id, "delete", {
                // Name WHOSE data, so an admin can't be tricked by an
                // unauthenticated request into erasing the wrong account.
                confirmText: `Delete/anonymize the data for "${String(
                  item.payload.contact ?? "(no contact on file)",
                )}" across every store? Only do this once you have verified — out of band — that the requester controls this contact. This cannot be undone.`,
              })
            }
          >
            Delete their data
          </button>
          <button
            className={`${actionBtn} border border-sand text-ink hover:border-tide`}
            disabled={busy || !note.trim()}
            title={note.trim() ? "" : "Type the hold reason in the note field first"}
            onClick={() => onFulfill(item.id, "hold-set", { reason: note })}
          >
            Place legal hold
          </button>
          <button
            className={`${actionBtn} border border-sand text-ink-soft hover:border-tide`}
            disabled={busy}
            onClick={() => onFulfill(item.id, "hold-clear")}
          >
            Clear hold
          </button>
        </>
      )}
      {kind === "records" && (
        <span className="text-xs text-ink-soft">
          Public-records request — fulfilled by a person (retention + legal-hold reconciliation).
          Resolve when handled.
        </span>
      )}
      <button
        className={`${actionBtn} border border-sand text-ink hover:border-tide`}
        disabled={busy}
        onClick={() => onResolve("fulfilled")}
      >
        Mark fulfilled
      </button>
    </div>
  );
}

const TYPE_LABELS: Record<WorklistType, string> = {
  moderation: "Moderation",
  sync_conflict: "Sync conflicts",
  staleness: "Re-verify",
  report_inaccurate: "Reports",
  privacy_request: "Privacy",
};

const TYPE_ORDER: WorklistType[] = [
  "moderation",
  "report_inaccurate",
  "staleness",
  "sync_conflict",
  "privacy_request",
];

const chipBase =
  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors";
const chipOn = `${chipBase} border-sound bg-sound text-white`;
const chipOff = `${chipBase} border-sand bg-white text-ink hover:border-tide`;
const actionBtn =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";

function activeCount(counts: WorklistCounts, type: WorklistType): number {
  return counts[type].open + counts[type].in_progress;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function isOverdue(item: WorklistItemView): boolean {
  return Boolean(
    item.dueAt &&
      new Date(item.dueAt).getTime() < Date.now() &&
      (item.state === "open" || item.state === "in_progress"),
  );
}

/** Render any payload value as short plain text (no rich diff machinery). */
function plain(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Field-by-field before/after for a moderation edit: every key where the
 *  proposal differs from the stored record. `status` is record metadata the
 *  admin read attaches — never a content field, so it's skipped. */
function changedFields(
  subject: Record<string, unknown> | null,
  proposed: Record<string, unknown>,
): { key: string; before: string; after: string }[] {
  const before = { ...(subject ?? {}) } as Record<string, unknown>;
  delete before.status;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(proposed)])].sort();
  return keys
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(proposed[k]))
    .map((k) => ({ key: k, before: plain(before[k]), after: plain(proposed[k]) }));
}

function DetailRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-ink">{r.label}:</dt>
          <dd className="min-w-0 break-words text-ink-soft">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PayloadDetail({ item }: { item: WorklistItemView }) {
  const p = item.payload;
  if (item.type === "moderation") {
    const kind = String(p.kind ?? "");
    if (kind === "edit" && p.proposed && typeof p.proposed === "object") {
      const diff = changedFields(item.subject, p.proposed as Record<string, unknown>);
      return (
        <div className="overflow-x-auto">
          <p className="mb-1 text-sm font-medium text-ink">Proposed changes</p>
          {diff.length === 0 ? (
            <p className="text-sm text-ink-soft">Identical to the stored record.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-soft">
                  <th className="pr-3 font-medium">Field</th>
                  <th className="pr-3 font-medium">Now</th>
                  <th className="font-medium">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.key} className="align-top">
                    <td className="pr-3 font-medium text-ink">{d.key}</td>
                    <td className="pr-3 text-ink-soft">{d.before}</td>
                    <td className="text-fern">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );
    }
    if (kind === "new") {
      const subject = item.subject ?? {};
      // `attachments` render as thumbnails below, not as a stringified array.
      const rows = Object.entries(subject)
        .filter(([k]) => k !== "status" && k !== "attachments")
        .map(([k, v]) => ({ label: k, value: plain(v) }));
      const attachments = Array.isArray(subject.attachments)
        ? (subject.attachments as unknown[]).filter((r): r is string => typeof r === "string")
        : [];
      // Anonymous public suggestions (E12) carry the submitter's PRIVATE
      // contact in the payload — shown here (admin-only) for follow-up, never
      // on the public event.
      const suggest = p.suggest as { submitterName?: string; contact?: string } | undefined;
      return (
        <div>
          <p className="mb-1 text-sm font-medium text-ink">New submission</p>
          {rows.length ? (
            <DetailRows rows={rows} />
          ) : (
            <p className="text-sm text-ink-soft">
              {plain(p.note) !== "—" ? plain(p.note) : "Held for review."}
            </p>
          )}
          {suggest?.submitterName && (
            <p className="mt-2 text-xs text-ink-soft">
              Submitted by {suggest.submitterName}
              {suggest.contact ? ` · reply to: ${suggest.contact}` : ""} (private)
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((ref) =>
                attachmentKind(ref) === "pdf" ? (
                  <a
                    key={ref}
                    href={attachmentPublicUrl(ref)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-sand-deep px-2.5 py-1.5 text-xs font-medium text-tide-deep hover:border-tide"
                  >
                    📄 PDF
                  </a>
                ) : (
                  <a key={ref} href={attachmentPublicUrl(ref)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachmentPublicUrl(ref)}
                      alt="submitted attachment"
                      loading="lazy"
                      className="h-20 w-20 rounded-lg object-cover ring-1 ring-sand-deep"
                    />
                  </a>
                ),
              )}
            </div>
          )}
        </div>
      );
    }
    return <DetailRows rows={[{ label: "Takedown", value: plain(p.note) }]} />;
  }
  if (item.type === "report_inaccurate") {
    const messages = Array.isArray(p.messages) ? (p.messages as Record<string, unknown>[]) : [];
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">
          {String(p.count ?? messages.length)} report{Number(p.count ?? 1) === 1 ? "" : "s"}
        </p>
        {messages.map((m, i) => (
          <div key={i} className="rounded-lg bg-sand/40 p-2 text-sm">
            <p className="text-ink">{plain(m.message)}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {plain(m.at).slice(0, 16).replace("T", " ")}
              {m.contact ? ` · reply to: ${plain(m.contact)}` : " · anonymous"}
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (item.type === "staleness") {
    return (
      <DetailRows
        rows={[
          { label: "Last verified", value: p.lastVerifiedAt ? String(p.lastVerifiedAt).slice(0, 10) : "never" },
          { label: "Re-check every", value: `${plain(p.intervalDays)} days` },
        ]}
      />
    );
  }
  if (item.type === "sync_conflict") {
    const fields = Array.isArray(p.fields) ? (p.fields as Record<string, unknown>[]) : [];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-soft">
              <th className="pr-3 font-medium">Field</th>
              <th className="pr-3 font-medium">This app</th>
              <th className="font-medium">AMS</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="align-top">
                <td className="pr-3 font-medium text-ink">{plain(f.name)}</td>
                <td className="pr-3 text-ink-soft">{plain(f.localValue)}</td>
                <td className="text-ink-soft">{plain(f.remoteValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-ink-soft">Fetched {plain(p.remoteFetchedAt)}</p>
      </div>
    );
  }
  // privacy_request
  return (
    <DetailRows
      rows={[
        { label: "Request", value: plain(p.requestKind) },
        { label: "Contact", value: plain(p.contact) },
        { label: "Scope", value: plain(p.scopeNote) },
      ]}
    />
  );
}

export function WorklistManager({
  initialItems,
  initialCounts,
  initialOpenId = null,
}: {
  initialItems: WorklistItemView[];
  initialCounts: WorklistCounts;
  /** Pre-expanded item (deep links; also how the render test exercises the
   *  detail panels). */
  initialOpenId?: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [typeFilter, setTypeFilter] = useState<WorklistType | "all">("all");
  const [assignee, setAssignee] = useState<"all" | "me" | "unassigned">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [view, setView] = useState<"active" | "resolved" | "dismissed">("active");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");

  async function refresh(over?: {
    type?: WorklistType | "all";
    assignee?: "all" | "me" | "unassigned";
    overdue?: boolean;
    view?: "active" | "resolved" | "dismissed";
  }) {
    const t = over?.type ?? typeFilter;
    const a = over?.assignee ?? assignee;
    const o = over?.overdue ?? overdueOnly;
    const v = over?.view ?? view;
    const params = new URLSearchParams();
    if (t !== "all") params.set("type", t);
    params.set("state", v);
    if (a !== "all") params.set("assignee", a);
    if (o) params.set("overdue", "1");
    const res = await fetch(`/api/admin/worklist?${params.toString()}`);
    const data = (await res.json().catch(() => ({}))) as {
      items?: WorklistItemView[];
      counts?: WorklistCounts;
      error?: string;
    };
    if (res.ok && data.items && data.counts) {
      setItems(data.items);
      setCounts(data.counts);
    } else {
      setMessage({ ok: false, text: data.error ?? "Could not load the queue" });
    }
  }

  async function act(
    body: Record<string, unknown>,
    confirmText?: string,
    okText = "Done",
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/worklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; rejected?: boolean };
      if (!res.ok) {
        setMessage({
          ok: false,
          text: data.rejected
            ? `Rejected instead — the proposal no longer validates: ${data.error}`
            : (data.error ?? "Action failed"),
        });
      } else {
        setMessage({ ok: true, text: okText });
        setNote("");
        setDue("");
        setOpenId(null);
      }
      await refresh();
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  // E11 privacy_request fulfillment — posts to the dedicated fulfill route
  // (not /api/admin/worklist), because access returns a downloadable bundle
  // and delete runs the PII-inventory sweep. Non-programmer-runnable: buttons
  // + a browser confirm, no scripts.
  async function privacyFulfill(
    itemId: string,
    op: "access" | "delete" | "hold-set" | "hold-clear",
    opts?: { reason?: string; confirmText?: string },
  ) {
    if (opts?.confirmText && !window.confirm(opts.confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/privacy/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, itemId, reason: opts?.reason }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        refused?: string;
        message?: string;
        export?: unknown;
      };
      if (!res.ok || data.ok === false) {
        setMessage({ ok: false, text: data.message ?? data.error ?? "Action failed" });
      } else if (op === "access" && data.export) {
        // Hand the admin a file to send the requester — no outbound send here.
        const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `privacy-access-${itemId.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMessage({ ok: true, text: "Access export downloaded — send it to the requester." });
      } else {
        setMessage({ ok: true, text: op === "delete" ? "Data deleted." : "Done." });
        setNote("");
      }
      await refresh();
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  function pick<T>(setter: (v: T) => void, key: "type" | "assignee" | "overdue" | "view") {
    return (value: T) => {
      setter(value);
      void refresh({ [key]: value } as Parameters<typeof refresh>[0]);
    };
  }
  const pickType = pick<WorklistType | "all">(setTypeFilter, "type");
  const pickAssignee = pick<"all" | "me" | "unassigned">(setAssignee, "assignee");
  const pickOverdue = pick<boolean>(setOverdueOnly, "overdue");
  const pickView = pick<"active" | "resolved" | "dismissed">(setView, "view");

  return (
    <div className="space-y-4">
      {/* type chips with active-count badges */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        <button className={typeFilter === "all" ? chipOn : chipOff} onClick={() => pickType("all")}>
          All ({TYPE_ORDER.reduce((n, t) => n + activeCount(counts, t), 0)})
        </button>
        {TYPE_ORDER.map((t) => (
          <button key={t} className={typeFilter === t ? chipOn : chipOff} onClick={() => pickType(t)}>
            {TYPE_LABELS[t]} ({activeCount(counts, t)})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by assignment">
        {(["all", "me", "unassigned"] as const).map((a) => (
          <button key={a} className={assignee === a ? chipOn : chipOff} onClick={() => pickAssignee(a)}>
            {a === "all" ? "Anyone" : a === "me" ? "Mine" : "Unassigned"}
          </button>
        ))}
        <button
          className={overdueOnly ? chipOn : chipOff}
          onClick={() => pickOverdue(!overdueOnly)}
          aria-pressed={overdueOnly}
        >
          Overdue
        </button>
        <span className="mx-1 hidden border-l border-sand sm:block" aria-hidden />
        {(["active", "resolved", "dismissed"] as const).map((v) => (
          <button key={v} className={view === v ? chipOn : chipOff} onClick={() => pickView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {message && (
        <p
          className={`text-sm font-medium ${message.ok ? "text-fern" : "text-coral-deep"}`}
          role="status"
        >
          {message.text}
        </p>
      )}

      {items.length === 0 && (
        <p className="text-sm text-ink-soft">Nothing here — the queue is clear. 🎉</p>
      )}

      <ul className="space-y-3">
        {items.map((item) => {
          const open = openId === item.id;
          const overdue = isOverdue(item);
          const kind = String(item.payload.kind ?? "");
          return (
            <li key={item.id}>
              <Card className={overdue ? "border-coral-deep" : undefined}>
                <button
                  className="flex w-full flex-wrap items-center gap-2 text-left"
                  onClick={() => setOpenId(open ? null : item.id)}
                  aria-expanded={open}
                >
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block font-semibold text-sound-deep">
                      {item.subjectLabel}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {item.subjectStore} · {new Date(item.createdAt).toLocaleDateString()}
                      {item.assigneeUserId ? ` · claimed` : ""}
                    </span>
                  </span>
                  <Badge tone="teal">
                    {TYPE_LABELS[item.type]}
                    {kind ? ` · ${kind}` : ""}
                  </Badge>
                  {overdue && <Badge tone="coral">Overdue {fmtDate(item.dueAt)}</Badge>}
                  {!overdue && item.dueAt && <Badge tone="sand">Due {fmtDate(item.dueAt)}</Badge>}
                  {item.state !== "open" && <Badge tone="sand">{item.state}</Badge>}
                </button>

                {open && (
                  <div className="mt-3 space-y-3 border-t border-sand pt-3">
                    <PayloadDetail item={item} />

                    {item.state === "resolved" || item.state === "dismissed" ? (
                      <DetailRows
                        rows={[
                          { label: "Outcome", value: item.resolution ?? item.state },
                          { label: "Note", value: item.resolutionNote ?? "—" },
                          { label: "By", value: item.resolvedBy ?? "—" },
                        ]}
                      />
                    ) : (
                      <>
                        <label className="block text-xs font-medium text-ink">
                          Note (required to reject)
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            className="mt-1 block w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-sm"
                          />
                        </label>

                        <div className="flex flex-wrap items-center gap-2">
                          {item.type === "moderation" && (
                            <>
                              <button
                                className={`${actionBtn} bg-sound text-white hover:bg-sound-deep`}
                                disabled={busy}
                                data-confirm={`Approve and publish "${item.subjectLabel}"?`}
                                onClick={() =>
                                  void act(
                                    { action: "approve", id: item.id },
                                    `Approve and publish "${item.subjectLabel}"?`,
                                    "Approved — it's live.",
                                  )
                                }
                              >
                                Approve
                              </button>
                              <button
                                className={`${actionBtn} border border-coral-deep text-coral-deep hover:bg-coral-deep/10`}
                                disabled={busy || !note.trim()}
                                data-confirm={`Reject "${item.subjectLabel}"? The submitter's note: your note is kept.`}
                                onClick={() =>
                                  void act(
                                    { action: "reject", id: item.id, note },
                                    `Reject "${item.subjectLabel}"?`,
                                    "Rejected.",
                                  )
                                }
                              >
                                Reject
                              </button>
                              {kind !== "takedown" && item.subject && (
                                <button
                                  className={`${actionBtn} border border-coral-deep text-coral-deep hover:bg-coral-deep/10`}
                                  disabled={busy}
                                  data-confirm={`Take "${item.subjectLabel}" off the public site now?`}
                                  onClick={() =>
                                    void act(
                                      {
                                        action: "takedown",
                                        store: item.subjectStore,
                                        subjectId: item.subjectId,
                                        note: note || undefined,
                                      },
                                      `Take "${item.subjectLabel}" off the public site now?`,
                                      "Taken down.",
                                    )
                                  }
                                >
                                  Take down
                                </button>
                              )}
                            </>
                          )}
                          {item.type === "staleness" && (
                            <>
                              <button
                                className={`${actionBtn} bg-sound text-white hover:bg-sound-deep`}
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    { action: "verify", id: item.id, note },
                                    undefined,
                                    "Marked verified.",
                                  )
                                }
                              >
                                Still accurate
                              </button>
                              <button
                                className={`${actionBtn} border border-sand text-ink hover:border-tide`}
                                disabled={busy}
                                data-confirm={`Archive "${item.subjectLabel}"? Mark it for cleanup instead of verifying.`}
                                onClick={() =>
                                  void act(
                                    { action: "resolve", id: item.id, resolution: "archived", note },
                                    `Archive "${item.subjectLabel}"?`,
                                    "Archived.",
                                  )
                                }
                              >
                                Archive
                              </button>
                            </>
                          )}
                          {item.type === "report_inaccurate" && (
                            <button
                              className={`${actionBtn} bg-sound text-white hover:bg-sound-deep`}
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  { action: "resolve", id: item.id, resolution: "fixed", note },
                                  undefined,
                                  "Marked fixed.",
                                )
                              }
                            >
                              Fixed it
                            </button>
                          )}
                          {item.type === "sync_conflict" && (
                            <span className="text-xs text-ink-soft">
                              Tools for this queue arrive with its producer epic — resolve or
                              dismiss below if it&apos;s already handled.
                            </span>
                          )}
                          {item.type === "privacy_request" && (
                            <PrivacyRequestTools
                              item={item}
                              busy={busy}
                              note={note}
                              actionBtn={actionBtn}
                              onFulfill={privacyFulfill}
                              onResolve={(resolution) =>
                                void act(
                                  { action: "resolve", id: item.id, resolution, note },
                                  undefined,
                                  "Resolved.",
                                )
                              }
                            />
                          )}

                          {!item.assigneeUserId && (
                            <button
                              className={`${actionBtn} border border-sand text-ink hover:border-tide`}
                              disabled={busy}
                              onClick={() =>
                                void act({ action: "claim", id: item.id }, undefined, "Claimed.")
                              }
                            >
                              Claim
                            </button>
                          )}
                          <button
                            className={`${actionBtn} border border-sand text-ink-soft hover:border-tide`}
                            disabled={busy}
                            data-confirm={`Dismiss "${item.subjectLabel}" without action?`}
                            onClick={() =>
                              void act(
                                { action: "dismiss", id: item.id, note: note || undefined },
                                `Dismiss "${item.subjectLabel}" without action?`,
                                "Dismissed.",
                              )
                            }
                          >
                            Dismiss
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs font-medium text-ink">
                            Due
                            <input
                              type="date"
                              value={due}
                              onChange={(e) => setDue(e.target.value)}
                              className="ml-2 rounded-lg border border-sand bg-white px-2 py-1 text-sm"
                            />
                          </label>
                          <button
                            className={`${actionBtn} border border-sand text-ink hover:border-tide`}
                            disabled={busy || !due}
                            onClick={() =>
                              void act(
                                { action: "due", id: item.id, dueAt: `${due}T17:00:00-07:00` },
                                undefined,
                                "Due date set.",
                              )
                            }
                          >
                            Set due date
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
