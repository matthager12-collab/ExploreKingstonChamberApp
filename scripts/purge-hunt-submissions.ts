// E11 retention purge CLI — operator-side runner to purge stranded hunt submissions.
//
//   npm run purge:hunt-submissions                  (dry-run: prints the plan, deletes NOTHING)
//   npm run purge:hunt-submissions -- --apply       (execute; staging first, always)
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { unlink } from "fs/promises";
import path from "path";
import { dataPath } from "../src/lib/data-dir";
import { readMerged } from "../src/lib/stores/json-store";
import { hardDeleteRecords, isUnderLegalHold } from "../src/lib/db/privacy-delete";
import { deleteBlob, deleteObject, hasR2 } from "../src/lib/blob-store";

const SUBMISSIONS_STORE = "hunt-submissions";
const DATA_ROOT = dataPath("hunts");

function isBlobUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("https://");
}

async function destroySubmissionPhoto(photoPath: string): Promise<void> {
  if (isBlobUrl(photoPath)) {
    await deleteBlob(photoPath);
    return;
  }
  const abs = path.resolve(DATA_ROOT, photoPath);
  if (!abs.startsWith(path.resolve(DATA_ROOT) + path.sep)) {
    throw new Error("destroySubmissionPhoto: path escapes the hunts data dir");
  }
  if (hasR2()) {
    await deleteObject(`hunts/${photoPath}`);
  }
  try {
    await unlink(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the retention target).");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL!).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
})();

async function purgeHunts(): Promise<number> {
  const subs = await readMerged<{ id: string, photoPath: string }>(SUBMISSIONS_STORE, []);
  
  let toDelete = 0;
  let held = 0;
  let deleted = 0;
  const stuck: { id: string; why: string }[] = [];

  for (const sub of subs) {
    if (!sub.id) continue;
    if (await isUnderLegalHold(SUBMISSIONS_STORE, sub.id)) {
      held++;
      continue;
    }
    toDelete++;
    if (!apply) continue;

    // Photo first, then the row — and if the photo will not go, KEEP the row
    // so a later run retries it. An orphaned row is recoverable; an orphaned
    // photo with no row pointing at it is not. This is the contract the
    // retention executor had, and one stuck photo (an untrusted URL, say)
    // must not abort the purge of everything after it.
    try {
      await destroySubmissionPhoto(sub.photoPath);
    } catch (err) {
      stuck.push({ id: sub.id, why: err instanceof Error ? err.message : "unknown" });
      continue;
    }
    const res = await hardDeleteRecords(SUBMISSIONS_STORE, [sub.id]);
    if (res.deleted > 0) deleted++;
    else if (res.heldSkipped.length > 0) held++;
    else stuck.push({ id: sub.id, why: "the row was already gone" });
  }

  console.log(`purge-hunt-submissions ${apply ? "execute" : "dry-run"} against ${host}`);
  console.log(`  submissions found        ${subs.length}`);
  console.log(`  under legal hold         ${held}`);
  console.log(`  targeted for deletion    ${toDelete}`);

  if (apply) {
    console.log(`  deleted                  ${deleted}`);
    console.log(`  kept, photo would not go ${stuck.length}`);
    for (const s of stuck) console.log(`    ${s.id}: ${s.why}`);
    if (stuck.length > 0) {
      console.log("  Those rows were kept on purpose. Run again after fixing the photo.");
    }
  } else {
    console.log("dry-run: nothing was deleted. Re-run with --apply to execute.");
  }
  return stuck.length;
}

purgeHunts().then(
  (stuck) => process.exit(stuck === 0 ? 0 : 1),
  (err) => {
    console.error("purge-hunt-submissions failed:", err);
    process.exit(1);
  }
);
