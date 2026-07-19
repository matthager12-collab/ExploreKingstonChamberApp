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
import { readdir, readFile } from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/auth";
import { dataDir } from "@/lib/data-dir";
import { serializeDb } from "@/lib/db/export";

export const dynamic = "force-dynamic";

interface BundledFile {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}

const TEXT_EXT = /\.(json|jsonl|txt|md|csv)$/i;

async function walk(dir: string, base: string): Promise<BundledFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // dir doesn't exist yet (nothing written) — empty backup
  }
  const out: BundledFile[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else if (e.isFile()) {
      const buf = await readFile(full);
      const isText = TEXT_EXT.test(e.name);
      out.push({
        path: path.relative(base, full),
        encoding: isText ? "utf8" : "base64",
        content: isText ? buf.toString("utf8") : buf.toString("base64"),
      });
    }
  }
  return out;
}

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
  // the scheduled workflow has no cookie to send, so a valid token skips the
  // session gate entirely. Everything else falls through to the shared gate.
  if (!hasValidBackupToken(request)) {
    const denied = await requireAdmin();
    if (denied) return denied;
  }

  const root = dataDir();
  const files = await walk(root, root);
  const bundle = {
    app: "explore-kingston",
    version: 2,
    createdAt: new Date().toISOString(),
    dataDir: root,
    fileCount: files.length,
    files,
    db: await serializeDb(),
  };

  const date = new Date().toISOString().slice(0, 10);
  // Pretty-printed (indent 1) per M-20-07: backup bundles must stay
  // human-readable — the Chamber has to be able to open one in a text editor.
  return new Response(JSON.stringify(bundle, null, 1), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="explore-kingston-backup-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
