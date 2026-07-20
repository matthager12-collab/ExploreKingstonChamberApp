"use client";

// E09 provenance strip: where a record came from (source badge), its external
// id when the AMS seam has populated one, and who touched it last. Mounted
// beside every non-frozen admin editor's selected record.
//
// Two modes: pass `meta` when the caller already has the record's metadata
// (server pages), or leave it off and the strip fetches it from
// GET /api/admin/audit?store&recordId&limit=1. It refetches when a restore
// completes anywhere on the page (the RESTORED_EVENT window event), so the
// "Edited by" line never goes stale after an undo.

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui";

import {
  type AuditPage,
  type RecordMetaView,
  RESTORED_EVENT,
  fmtWhen,
  relativeTime,
  sourceTone,
} from "./audit-ui";

export function Provenance({
  store,
  recordId,
  meta: metaProp,
}: {
  store: string;
  recordId: string;
  meta?: RecordMetaView | null;
}) {
  const [fetched, setFetched] = useState<RecordMetaView | null | undefined>(
    undefined,
  );

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ store, recordId, limit: "1" });
      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as AuditPage;
      setFetched(data.recordMeta ?? null);
    } catch {
      // Leave the strip in its "no metadata" state — provenance is
      // informational chrome, never worth an error banner.
    }
  }, [store, recordId]);

  useEffect(() => {
    if (metaProp !== undefined) return;
    // Microtask boundary: no synchronous setState from an effect body.
    queueMicrotask(() => void load());
  }, [metaProp, load]);

  useEffect(() => {
    const onRestored = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { store?: string; recordId?: string }
        | undefined;
      if (detail?.store === store && detail?.recordId === recordId) void load();
    };
    window.addEventListener(RESTORED_EVENT, onRestored);
    return () => window.removeEventListener(RESTORED_EVENT, onRestored);
  }, [store, recordId, load]);

  const meta = metaProp !== undefined ? metaProp : fetched;

  if (meta === undefined) return null; // still loading — no layout jump
  if (meta === null) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <Badge tone="navy">seed</Badge>
        <span>Original content — no changes recorded yet.</span>
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
      <Badge tone={sourceTone(meta.source)}>{meta.source}</Badge>
      {meta.status !== "live" && <Badge tone="sand">{meta.status}</Badge>}
      {meta.deleted && <Badge tone="coral">deleted</Badge>}
      {meta.externalId && (
        <span className="font-mono">ext: {meta.externalId}</span>
      )}
      <span title={fmtWhen(meta.updatedAt)}>
        Edited by {meta.updatedBy ?? "unknown"} · {relativeTime(meta.updatedAt)}
      </span>
    </p>
  );
}
