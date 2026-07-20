// Admin-only off-site backup (v2): streams the entire mutable data directory
// (photos, maps, any remaining disk files) PLUS the full Postgres substrate
// (record/audit/quarantine + the append-only logs, via the data layer's
// serializeDb()) as a single downloadable JSON bundle. This is the
// platform-independent backup — Render already snapshots the disk daily, but
// this lets the Chamber pull a copy off Render entirely (important for
// LTAC/survey records).
//
// Text files (.json/.jsonl/.txt/.md) are inlined as UTF-8; everything else
// (photos) is base64. Restore: disk files with scripts/restore-backup.mjs,
// the db section with `npm run restore:db` (scripts/restore-db.ts).
//
// Auth: an admin session, OR — when the BACKUP_TOKEN env var is set — a
// matching `Authorization: Bearer <token>` header. BACKUP_TOKEN is a
// read-only, single-purpose credential for the scheduled off-site backup
// workflow (.github/workflows/backup-offsite.yml); it grants nothing else
// anywhere. When BACKUP_TOKEN is unset, behavior is admin-session-only, same
// as before. The bundle contains password hashes — treat the downloaded file
// as sensitive. (Audit rows redact password material at write time, but the
// record rows for auth-users still contain the hashes.)
//
// 401 signed out · 403 signed in but not admin. This route used to answer 403
// to both; E06 normalized it onto the shared gate so every endpoint reports
// "who are you?" and "may you?" with distinct codes.

import { timingSafeEqual } from "crypto";
import { requireAdmin } from "@/lib/auth";
import { dataDir } from "@/lib/data-dir";
import { serializeDb } from "@/lib/db/export";
import { streamBundleDocument } from "@/lib/backup-bundle";
import { recordMarker } from "@/lib/stores/ops-markers-store";

// fs walk + pg both need Node; never edge. dynamic so the bundle is never
// prerendered/cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidBackupToken(request: Request): boolean {
  const configured = process.env.BACKUP_TOKEN;
  if (!configured) return false;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  // The bearer token is a full ALTERNATIVE to a session, not an addition to it:
  // the scheduled off-site workflow has no cookie to send, so a valid token skips
  // the session gate entirely. Everything else falls through to the shared gate.
  // Order matters: token first, THEN requireAdmin — so an unauthenticated,
  // no-bearer request returns EXACTLY 401 (the pinned admin-walk assertion),
  // and a signed-in non-admin (e.g. moderator) gets 403. The bundle carries
  // password hashes, so only the admin tier may download it.
  if (!hasValidBackupToken(request)) {
    const denied = await requireAdmin();
    if (denied) return denied;
  }

  const root = dataDir();
  const createdAt = new Date().toISOString();
  // Serialize the (small) DB section BEFORE the stream opens: a serialize failure
  // then becomes a clean 500 with no headers sent, preserving the loud-failure
  // property the off-site cron's `curl -f` relies on. Only file-read errors can
  // happen mid-stream, and those abort the transfer (below).
  const dbSection = await serializeDb();

  const iterator = streamBundleDocument(root, { createdAt, dbSection });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    // Pull-based: the runtime calls pull() only when the consumer has room, so
    // peak memory is ~one file — not the whole disk (the old buffered impl OOMed
    // the 512 MB instance under a well-used disk).
    async pull(controller) {
      try {
        const res = await iterator.next();
        if (res.done) {
          controller.close();
          // Bundle fully generated. Record success as best-effort telemetry —
          // a marker-write failure must not fail a backup that already
          // succeeded, and a client that disconnected mid-stream never reaches
          // here, so a partial download is never marked a success.
          void recordMarker("backup:last-success", {
            fileCount: res.value,
            kind: "bundle-download",
          }).catch(() => {});
        } else {
          controller.enqueue(encoder.encode(res.value));
        }
      } catch (err) {
        // Abort the transfer so a mid-stream read failure surfaces as a broken
        // download (curl -f exits non-zero, the cron alert fires) — NEVER a
        // truncated 200 the cron encrypts and stores as a good backup.
        controller.error(err);
      }
    },
    cancel() {
      // Client/cron disconnected — stop generating and release any open handle.
      void iterator.return?.(0);
    },
  });

  const date = createdAt.slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="explore-kingston-backup-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
