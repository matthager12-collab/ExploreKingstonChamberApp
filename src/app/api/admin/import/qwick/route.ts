// Admin Qwick import API (E17 charter step 5, NFR-A33) — the no-terminal
// path to the importer. Backs /admin/import/qwick.
//
// POST { mode: "preview" | "apply", export?: unknown }
//   The operator's saved export (raw GraphQL envelope or bare rows array —
//   rowsFromExport accepts both) is the PRIMARY input: the vendor API died
//   2026-08-01 (docs/QWICK-DECOMMISSION.md). Omitting `export` falls back to
//   the live fetch, kept for the case the vendor resurrects; its failure is a
//   502 pointing back at the saved-export path.
//   - preview: plan + persist a dry_run row; NO record is touched.
//   - apply: RE-plans from the submitted rows (never applies a stored plan —
//     the DB may have moved since the preview) and executes through
//     applyQwickPlan. Record writes stay stamped updated_by 'import:qwick'
//     (the precedence-law discriminator — load-bearing); only the import_run
//     row's runBy carries the admin's email.
// GET → the last 20 import runs (report stripped: the full bucketed plan can
//   be hundreds of KB per run; the history list only needs the summary).
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// UI; these handlers re-check because route handlers bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  applyQwickPlan,
  fetchQwickListings,
  IMPORT_PRINCIPAL,
  listImportRuns,
  persistDryRun,
  planQwickImport,
  readAliases,
  readLocalRecords,
  rowsFromExport,
} from "@/lib/import/qwick";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

/** Body cap (~6 MB). The real 166-listing export is well under 1 MB; anything
 *  bigger than this is a mistake, not a bigger kiosk. */
const MAX_BODY_CHARS = 6 * 1024 * 1024;
/** Row cap — an export claiming more rows than this is not a Kingston export. */
const MAX_ROWS = 2000;

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it for the run row.
  const actor = (await getSessionUser())!.email;

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return bad(
      "Request body too large (the cap is 6 MB). A real Qwick export is well under 1 MB — check you pasted the export itself, not a page dump.",
      413,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return bad("Invalid request body");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const mode = body.mode;
  if (mode !== "preview" && mode !== "apply") {
    return bad('mode must be "preview" or "apply"');
  }

  let rows: unknown[];
  if (body.export !== undefined) {
    try {
      rows = rowsFromExport(body.export);
    } catch (err) {
      return bad(err instanceof Error ? err.message : "Unrecognized export shape.");
    }
  } else {
    // Live-fetch fallback — kept for the case the vendor resurrects.
    try {
      rows = await fetchQwickListings();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return bad(
        `The live Qwick API could not be reached (the vendor has been dead since 2026-08-01): ${detail}. Paste or upload a saved export instead — recovery options are in docs/QWICK-DECOMMISSION.md.`,
        502,
      );
    }
  }

  if (rows.length > MAX_ROWS) {
    return bad(`Export has ${rows.length} rows — the cap is ${MAX_ROWS}.`);
  }

  // Both modes plan fresh from the submitted rows against the CURRENT
  // database — an apply never trusts a previously stored plan (TOCTOU).
  const plan = planQwickImport(rows, await readLocalRecords(), await readAliases());

  try {
    if (mode === "preview") {
      const { runId, stats } = await persistDryRun(plan, actor);
      return NextResponse.json({ runId, stats, plan });
    }
    // Record writes keep the importer principal (precedence law); the run row
    // records which admin pressed the button.
    const { runId, stats } = await applyQwickPlan(plan, IMPORT_PRINCIPAL, actor);
    return NextResponse.json({ runId, stats });
  } catch (err) {
    // Should have quarantined at plan time; surfacing it beats a bare 500.
    if (err instanceof RecordValidationError) return bad(err.message);
    throw err;
  }
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const runs = await listImportRuns(20);
  return NextResponse.json({
    // Strip the full bucketed report: the history list renders mode / when /
    // runBy / stats only, and 20 full plans could be many MB of JSON.
    runs: runs.map(({ report: _report, ...rest }) => rest),
  });
}
