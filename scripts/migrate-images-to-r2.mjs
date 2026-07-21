#!/usr/bin/env node
// E15 slice 2 — copy every uploaded image from the Render persistent disk into
// the private Cloudflare R2 bucket, then prove the copy is complete before the
// disk is ever deleted.
//
// ── WHERE THIS RUNS ────────────────────────────────────────────────────────
// INSIDE THE RUNNING RENDER CONTAINER, over `render ssh`. The production
// DATA_DIR is a disk mounted only in the live web-service instance, so:
//   * a local checkout cannot see /data at all;
//   * a Render one-off job runs on a fresh instance WITHOUT the service's disk;
//   * and running --verify against a RESTORED BACKUP COPY is the dangerous
//     one — a stale copy passes a naive count check while silently missing
//     every image uploaded after the backup was taken, immediately before an
//     irreversible deletion.
// The runner image ships only .next/standalone, .next/static, public/ and
// db/migrations, so the Dockerfile copies scripts/ in for exactly this.
//
//   cd /app
//   env | grep R2_IMAGES_          # confirm the bucket is configured
//   node scripts/migrate-images-to-r2.mjs --dry-run
//   node scripts/migrate-images-to-r2.mjs
//   node scripts/migrate-images-to-r2.mjs          # again: must report 0 new
//   node scripts/migrate-images-to-r2.mjs --verify # must exit 0
//
// ── WHY THE KEYS LOOK LIKE THE DISK ────────────────────────────────────────
// R2 object keys are the file's path relative to DATA_DIR, unchanged. That is
// what makes this a PURE BYTE COPY with zero record rewrites: every stored
// record value keeps the exact string it already had, and every existing
// path-sanitisation regex keeps working.
//
// Bytes are copied VERBATIM — deliberately NOT re-stripped of EXIF in flight,
// because --verify compares by byte equality. Launch-forward uploads are
// stripped at the save choke point (M-16-02); a one-off sweep of pre-existing
// images is a separate backlog item. See docs/OPERATIONS.md.
//
// Imports Node built-ins + aws4fetch only (aws4fetch resolves from the
// standalone bundle because src/lib/blob-store.ts imports it statically), plus
// `pg` for the optional record-value assertion.

import { createHash } from "crypto";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { AwsClient } from "aws4fetch";

// Subtrees that hold uploaded image bytes. `events/` is included even though
// the epic doc omits it — event artwork/flyer attachments live there.
const SUBTREES = ["hunts/refs", "hunts/photos", "map/images", "events"];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY_RUN = has("--dry-run");
const VERIFY = has("--verify");
const CONCURRENCY = Number(opt("concurrency", "8"));
// Prefix every key. Used ONLY by the pre-bucket self-test, which exercises the
// real R2 API against a throwaway prefix. Production runs pass nothing.
const KEY_PREFIX = opt("key-prefix", "");
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), ".data");

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} is not set. This script needs the image bucket's config.`);
    process.exit(2);
  }
  return v;
}

const ENDPOINT = required("R2_IMAGES_ENDPOINT").replace(/\/+$/, "");
const BUCKET = required("R2_IMAGES_BUCKET");
const client = new AwsClient({
  accessKeyId: required("R2_IMAGES_ACCESS_KEY_ID"),
  secretAccessKey: required("R2_IMAGES_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});

const keyUrl = (key) =>
  `${ENDPOINT}/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

const CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
};
const contentType = (p) =>
  CONTENT_TYPES[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

// ---------------------------------------------------------------------------

/** Every file under DATA_DIR/<subtree>, as { key, abs, size }. */
async function walkDisk() {
  const out = [];
  for (const subtree of SUBTREES) {
    const root = path.join(DATA_DIR, subtree);
    await walk(root, out);
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));

  async function walk(dir, acc) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return; // subsystem never used — not an error
      throw err;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs, acc);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.startsWith(".")) continue; // .DS_Store and friends
      const { size } = await stat(abs);
      // The key IS the path relative to DATA_DIR — that mirroring is the whole
      // point (see header).
      const key = path.relative(DATA_DIR, abs).split(path.sep).join("/");
      acc.push({ key: KEY_PREFIX + key, abs, size });
    }
  }
}

/** Objects already in the bucket under a prefix, as Map<key, {size, etag}>. */
async function listBucket(prefix) {
  const found = new Map();
  let token;
  do {
    const url = new URL(`${ENDPOINT}/${BUCKET}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client.fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`list ${prefix} failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? -1);
      const etag = block.match(/<ETag>&quot;?([^<&]*)/)?.[1]?.replace(/"/g, "");
      if (key) found.set(decodeXml(key), { size, etag });
    }
    token = xml.includes("<IsTruncated>true</IsTruncated>")
      ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1]
      : undefined;
  } while (token);
  return found;
}

const decodeXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

const md5 = (buf) => createHash("md5").update(buf).digest("hex");

/** Bounded-concurrency map — a Chamber-sized disk, not a thundering herd. */
async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------

async function migrate(files, existing) {
  let uploaded = 0, skipped = 0, failed = 0;
  await pool(files, CONCURRENCY, async (f) => {
    const already = existing.get(f.key);
    if (already && already.size === f.size) {
      skipped++;
      return;
    }
    const bytes = await readFile(f.abs);
    const res = await client.fetch(keyUrl(f.key), {
      method: "PUT",
      body: bytes,
      headers: {
        "Content-Type": contentType(f.key),
        "Content-Length": String(bytes.byteLength),
      },
    });
    if (!res.ok) {
      failed++;
      console.error(`  FAILED ${f.key}: ${res.status} ${await res.text()}`);
      return;
    }
    uploaded++;
  });
  return { uploaded, skipped, failed };
}

/**
 * Parity: every disk file must exist in the bucket with the same size AND the
 * same content hash. R2 returns the MD5 as the ETag for a single-part PUT,
 * which is what makes a CHECKSUMMED (not merely counted) comparison cheap.
 */
async function verify(files, existing) {
  const problems = [];
  const bySubtree = new Map();

  for (const f of files) {
    const subtree = SUBTREES.find((s) => f.key.startsWith(KEY_PREFIX + s)) ?? "other";
    const tally = bySubtree.get(subtree) ?? { disk: 0, ok: 0 };
    tally.disk++;
    const obj = existing.get(f.key);
    if (!obj) {
      problems.push(`MISSING in R2: ${f.key}`);
    } else if (obj.size !== f.size) {
      problems.push(`SIZE MISMATCH: ${f.key} disk=${f.size} r2=${obj.size}`);
    } else {
      tally.ok++;
    }
    bySubtree.set(subtree, tally);
  }

  // Checksum every file whose size matched. At Chamber scale this is seconds,
  // and size-only equality would not catch a truncated or garbled upload.
  const checkable = files.filter((f) => {
    const o = existing.get(f.key);
    return o && o.size === f.size && o.etag && /^[a-f0-9]{32}$/.test(o.etag);
  });
  let checksummed = 0;
  await pool(checkable, CONCURRENCY, async (f) => {
    const local = md5(await readFile(f.abs));
    if (local !== existing.get(f.key).etag) {
      problems.push(`CHECKSUM MISMATCH: ${f.key}`);
    } else {
      checksummed++;
    }
  });

  console.log("\nParity by subtree:");
  for (const [subtree, t] of bySubtree) {
    console.log(`  ${subtree.padEnd(14)} disk=${String(t.disk).padStart(5)}  matched=${String(t.ok).padStart(5)}`);
  }
  console.log(`  checksum-verified: ${checksummed}/${checkable.length}`);

  // Objects in the bucket that no disk file accounts for. Not fatal — a
  // launch-forward upload lands in R2 only — but it must be VISIBLE, because
  // the alternative reading is that someone pointed this at the wrong bucket.
  const diskKeys = new Set(files.map((f) => f.key));
  const extra = [...existing.keys()].filter((k) => !diskKeys.has(k));
  if (extra.length) {
    console.log(`\n  note: ${extra.length} object(s) in R2 with no file on disk`);
    for (const k of extra.slice(0, 10)) console.log(`    + ${k}`);
    if (extra.length > 10) console.log(`    … and ${extra.length - 10} more`);
  }
  return problems;
}

/**
 * Guard the migration's core assumption: production has only fs-relative image
 * values. An https value would mean some record already points at Vercel Blob,
 * and copying disk bytes would not move it. Optional — skipped without
 * DATABASE_URL — and never fatal on its own, but loud.
 */
async function checkRecordValues() {
  if (!process.env.DATABASE_URL) {
    console.log("\nRecord-value check: SKIPPED (no DATABASE_URL)");
    return;
  }
  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.log("\nRecord-value check: SKIPPED (pg not resolvable here)");
    return;
  }
  const pool_ = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool_.query(
      `SELECT store, id, doc::text AS doc FROM record
        WHERE doc::text LIKE '%blob.vercel-storage.com%'
        LIMIT 20`,
    );
    if (rows.length === 0) {
      console.log("\nRecord-value check: OK — no record holds a Vercel Blob URL");
    } else {
      console.log(`\n!! Record-value check: ${rows.length} record(s) already hold an https blob URL:`);
      for (const r of rows) console.log(`     ${r.store}/${r.id}`);
      console.log("   Those images are NOT on this disk — copying bytes will not move them.");
      console.log("   Stop and reconcile before deleting the disk.");
    }
  } finally {
    await pool_.end();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`DATA_DIR : ${DATA_DIR}`);
  console.log(`bucket   : ${BUCKET}`);
  console.log(`endpoint : ${ENDPOINT}`);
  if (KEY_PREFIX) console.log(`key prefix: ${KEY_PREFIX}  (SELF-TEST MODE)`);
  console.log(`mode     : ${VERIFY ? "verify" : DRY_RUN ? "dry-run" : "migrate"}\n`);

  const files = await walkDisk();
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  console.log(`Found ${files.length} file(s) on disk, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  for (const subtree of SUBTREES) {
    const n = files.filter((f) => f.key.startsWith(KEY_PREFIX + subtree)).length;
    console.log(`  ${subtree.padEnd(14)} ${n}`);
  }

  if (DRY_RUN) {
    console.log("\nManifest (first 40):");
    for (const f of files.slice(0, 40)) console.log(`  ${f.key}  ${f.size}B`);
    if (files.length > 40) console.log(`  … and ${files.length - 40} more`);
    console.log("\nDry run — nothing uploaded.");
    return 0;
  }

  // One list up front serves both idempotency and parity.
  const existing = new Map();
  for (const subtree of SUBTREES) {
    for (const [k, v] of await listBucket(KEY_PREFIX + subtree)) existing.set(k, v);
  }
  console.log(`\nBucket currently holds ${existing.size} object(s) under those prefixes`);

  if (VERIFY) {
    const problems = await verify(files, existing);
    await checkRecordValues();
    if (problems.length) {
      console.error(`\nFAIL — ${problems.length} problem(s):`);
      for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
      if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
      return 1;
    }
    console.log("\nOK — every file on disk is present in R2 with matching size and checksum.");
    return 0;
  }

  const { uploaded, skipped, failed } = await migrate(files, existing);
  console.log(`\nuploaded=${uploaded}  skipped(already present)=${skipped}  failed=${failed}`);
  if (failed) {
    console.error("FAIL — some uploads failed; re-run (the script is idempotent).");
    return 1;
  }
  if (uploaded === 0) console.log("Nothing new — the bucket already matches the disk.");
  console.log("\nNext: re-run this command (expect uploaded=0), then --verify.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(2);
  });
