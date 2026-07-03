// Admin-only off-site backup: streams the entire mutable data directory
// (accounts, portal overlays, analytics, survey, hunts + photos, maps) as a
// single downloadable JSON bundle. This is the platform-independent backup —
// Render already snapshots the disk daily, but this lets the Chamber pull a
// copy off Render entirely (important for LTAC/survey records).
//
// Text files (.json/.jsonl/.txt/.md) are inlined as UTF-8; everything else
// (photos) is base64. Restore with scripts/restore-backup.mjs.
//
// Auth: admin session only. The bundle contains password hashes — treat the
// downloaded file as sensitive.

import { readdir, readFile } from "fs/promises";
import path from "path";
import { getSessionUser } from "@/lib/auth";
import { dataDir } from "@/lib/data-dir";

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

export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "admin") {
    return Response.json({ error: "admin only" }, { status: 403 });
  }

  const root = dataDir();
  const files = await walk(root, root);
  const bundle = {
    app: "explore-kingston",
    version: 1,
    createdAt: new Date().toISOString(),
    dataDir: root,
    fileCount: files.length,
    files,
  };

  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(bundle), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="explore-kingston-backup-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
