// GET /api/admin/audit — the immutable trail, surfaced (E09; FR-A05).
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; this handler re-checks because API routes bypass layouts.
//
// Query params mirror the read layer's filters: store, recordId, actor,
// action, from, to (ISO or YYYY-MM-DD; date-only `to` means end of that UTC
// day), cursor (an audit id), limit (≤200). When store AND recordId are both
// present the response adds `recordMeta` for the provenance strip.
// `format=csv` downloads metadata columns only — never document bodies: CSV
// re-opens the PII surface and blows columns — capped at 10,000 rows of the
// current filter. Everything served here is redacted by the read layer;
// nothing in this file touches the audit table directly.

import { NextRequest, NextResponse } from "next/server";

import {
  type AuditEntry,
  type AuditFilters,
  getRecordMetaView,
  listAudit,
  listAuditForExport,
} from "@/lib/audit/read";
import {
  getRestoreEntry,
  isRestorableAction,
} from "@/lib/audit/restore-registry";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(
  raw: string | null,
  endOfDay: boolean,
): Date | null | "invalid" {
  if (!raw) return null;
  const iso = DATE_ONLY_RE.test(raw)
    ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/** The UI's restore buttons key off this server-side verdict — the client
 *  never guesses at registry membership or the restorable-action set. */
function withRestorable(e: AuditEntry): AuditEntry & { restorable: boolean } {
  return {
    ...e,
    restorable:
      !e.metadataOnly && isRestorableAction(e.action) && Boolean(getRestoreEntry(e.store)),
  };
}

/** CSV cell: formula-injection-proofed (leading = + - @ get a ' prefix),
 *  then RFC-quoted when it carries commas/quotes/newlines. */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const filters: AuditFilters = {};
  for (const key of ["store", "recordId", "actor", "action"] as const) {
    const value = params.get(key)?.trim();
    if (value) filters[key] = value;
  }
  const from = parseDateParam(params.get("from"), false);
  if (from === "invalid") return bad("Invalid 'from' date");
  if (from) filters.from = from;
  const to = parseDateParam(params.get("to"), true);
  if (to === "invalid") return bad("Invalid 'to' date");
  if (to) filters.to = to;

  if (params.get("format") === "csv") {
    const entries = await listAuditForExport(filters);
    const lines = ["ts,actor,action,store,record_id,source"];
    for (const e of entries) {
      lines.push(
        [e.ts, e.actor, e.action, e.store, e.recordId, e.source]
          .map(csvCell)
          .join(","),
      );
    }
    const date = new Date().toISOString().slice(0, 10);
    return new Response(lines.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-export-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  let cursor: number | undefined;
  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    cursor = Number.parseInt(rawCursor, 10);
    if (Number.isNaN(cursor)) return bad("Invalid cursor");
  }
  let limit: number | undefined;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    limit = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(limit) || limit < 1) return bad("Invalid limit");
  }

  // A record-pinned request (the history panel / provenance strip) also gets
  // the record's current metadata — no second endpoint. Extra filters still
  // apply, so the browser's filter bar composes with a record link.
  const page = await listAudit(filters, { cursor, limit });
  const entries = page.entries.map(withRestorable);
  if (filters.store && filters.recordId) {
    const recordMeta = await getRecordMetaView(filters.store, filters.recordId);
    return NextResponse.json({ entries, nextCursor: page.nextCursor, recordMeta });
  }
  return NextResponse.json({ entries, nextCursor: page.nextCursor });
}
