// E11 retention purge endpoint — POST runs the RETENTION_POLICY manifest
// (src/lib/privacy/retention.ts). Body {"apply": true} executes; anything
// else is a DRY-RUN (counts only, deletes nothing) — the safe default for a
// misconfigured scheduler.
//
// Auth: an admin session OR `Authorization: Bearer $RETENTION_TOKEN`
// (?token= accepted — same fail-closed pattern as the E08 sweep: env unset
// means the token path doesn't exist). The proxy's MACHINE_TOKEN_ROUTES
// carve-out (src/proxy.ts) lets the cron's Bearer request reach this
// re-check — without that entry the request dies at the session gate (the
// bug that broke nightly backups; docs/OPERATIONS.md).
//
// Scheduling: .github/workflows/privacy-retention.yml, workflow_dispatch-only
// until the E11 §4-e staging evidence lands (ships dark by design).

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { runRetention } from "@/lib/privacy/retention";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const expected = process.env.RETENTION_TOKEN;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("token") ??
    "";
  const tokenOk = Boolean(expected && provided && provided === expected);

  if (!tokenOk) {
    const denied = await requireAdmin();
    if (denied) return denied;
    // Session path: fine — the report is admin-facing either way.
    await getSessionUser();
  }

  let apply = false;
  try {
    const body = (await request.json()) as { apply?: unknown };
    apply = body.apply === true;
  } catch {
    // no/invalid body → dry-run
  }

  const report = await runRetention({ apply });
  return NextResponse.json(report);
}
