// E05 importer core: load a DATA_DIR-shaped tree into the Postgres substrate
// with a dry-run diff and a quarantine workflow. Callable library — the
// vitest `importer` suite runs it in-process over PGlite (the data layer's
// getDb() honors __setDbForTests), and the thin CLI wrapper
// (import-data-dir.ts) provides argv parsing, the interactive confirm, and
// process.exit. See the CLI header for operator semantics.
//
// Invariants (epic P1-E05 §4):
//  - The source tree is opened READ-ONLY; no code path writes into dataDir.
//  - A file that exists but fails to parse throws HaltError (CLI exit 1) with
//    the filename — never a silent empty store. Corrupt JSONL LINES are
//    reported per-line and quarantined instead.
//  - Structured records validate against the baseline store schemas;
//    failures land in `quarantine` (apply) + the QUARANTINE report (always),
//    never in `record`.
//  - No Blob uploads / path rewriting (images stay on disk this epic), so
//    legacy synthetic submission ids are computed over the RAW row — fixing
//    the old script's re-upload idempotency hole.
//  - exitCode 0 = clean, 2 = quarantines/corrupt lines exist.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  appendAnalyticsEvent,
  appendFerryObservation,
  appendSurveyResponse,
  countAppendRows,
} from "../src/lib/db/append";
import {
  insertQuarantineRow,
  readRecordRows,
  writeRecord,
  type WriteMeta,
} from "../src/lib/db/records";
import { RecordValidationError, validateRecord } from "../src/lib/db/store-schemas";

export type ImportOptions = {
  dataDir: string;
  apply: boolean;
  forceAppend: boolean;
  /** Called before writes when apply is true; return false to abort. */
  confirm: (host: string, summary: string) => Promise<boolean>;
  /** Target label for the report (host of DATABASE_URL, or "test-db"). */
  host: string;
  log?: (line: string) => void;
};

export type StoreCounts = {
  total: number;
  new: number;
  changed: number;
  unchanged: number;
  tombstones: number;
  quarantined: number;
};

export type ImportResult = {
  exitCode: 0 | 2;
  aborted?: boolean;
  perStore: Record<string, StoreCounts>;
  written: number;
  quarantined: { store: string; id: string; where: string; errors: unknown }[];
  appendTables: Record<
    string,
    { source: number; target: number; corrupt: number; appended: boolean }
  >;
};

/** Unparseable source FILE (corrupt lines are handled, not thrown). */
export class HaltError extends Error {}

const IMPORT_META: WriteMeta = {
  actor: "import:data-dir",
  source: "import",
  status: "live",
  action: "import",
};

// -- read helpers -----------------------------------------------------------

async function readJsonArray(file: string): Promise<unknown[] | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new HaltError(`${file} exists but is not valid JSON (${(e as Error).message})`);
  }
  if (!Array.isArray(parsed)) throw new HaltError(`${file} parsed but is not a JSON array`);
  return parsed as unknown[];
}

type JsonlLine =
  | { line: number; value: unknown }
  | { line: number; corrupt: string; error: string };

async function readJsonl(file: string): Promise<JsonlLine[] | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const out: JsonlLine[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push({ line: i + 1, value: JSON.parse(line) });
    } catch (e) {
      out.push({ line: i + 1, corrupt: line.slice(0, 200), error: (e as Error).message });
    }
  }
  return out;
}

/** Deterministic synthetic id for legacy id-less hunt submissions — VERBATIM
 *  the old migrate-to-db.mjs logic so re-imports upsert the same rows. */
export function submissionId(sub: Record<string, unknown>): string {
  const parts = [sub.ts, sub.huntId, sub.stopId, sub.photoPath].map((v) => String(v ?? ""));
  return parts.join("|").replace(/\s+/g, "_").slice(0, 200);
}

/** Stable stringify (sorted keys) for change detection. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

// -- main -------------------------------------------------------------------

export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const dataDir = opts.dataDir;

  type Incoming = { store: string; id: string; doc: Record<string, unknown>; deleted: boolean };
  type Quarantined = {
    store: string;
    id: string;
    doc: Record<string, unknown> | null;
    errors: unknown;
    where: string;
  };
  const incoming: Incoming[] = [];
  const quarantined: Quarantined[] = [];

  function takeRecord(store: string, raw: unknown, where: string): void {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      quarantined.push({
        store,
        id: `malformed:${quarantined.length}`,
        doc: null,
        errors: [{ message: `not an object (${where})` }],
        where,
      });
      return;
    }
    const rec = { ...(raw as Record<string, unknown>) };
    const deleted = rec._deleted === true;
    delete rec._deleted;
    const id = typeof rec.id === "string" && rec.id ? rec.id : undefined;
    if (!id) {
      quarantined.push({
        store,
        id: `missing-id:${quarantined.length}`,
        doc: rec,
        errors: [{ message: `record has no string id (${where})` }],
        where,
      });
      return;
    }
    try {
      validateRecord(store, rec, { tombstone: deleted });
    } catch (e) {
      if (e instanceof RecordValidationError) {
        quarantined.push({ store, id, doc: rec, errors: e.issues, where });
        return;
      }
      throw e;
    }
    incoming.push({ store, id, doc: rec, deleted });
  }

  // stores/*.json — store name = filename.
  const storesDir = path.join(dataDir, "stores");
  let storeFiles: string[] = [];
  try {
    storeFiles = (await readdir(storesDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    storeFiles = [];
  }
  for (const f of storeFiles) {
    const rows = await readJsonArray(path.join(storesDir, f));
    for (const r of rows ?? []) takeRecord(f.replace(/\.json$/, ""), r, `stores/${f}`);
  }

  // auth/ — invites get the code→id mirror the app maintains.
  for (const u of (await readJsonArray(path.join(dataDir, "auth", "users.json"))) ?? []) {
    takeRecord("auth-users", u, "auth/users.json");
  }
  for (const inv of (await readJsonArray(path.join(dataDir, "auth", "invites.json"))) ?? []) {
    const withId =
      inv && typeof inv === "object" && !Array.isArray(inv)
        ? { id: (inv as Record<string, unknown>).code, ...(inv as Record<string, unknown>) }
        : inv;
    takeRecord("auth-invites", withId, "auth/invites.json");
  }

  // hunts/ — custom hunts verbatim; submissions get synthetic ids.
  for (const h of (await readJsonArray(path.join(dataDir, "hunts", "custom-hunts.json"))) ?? []) {
    takeRecord("custom-hunts", h, "hunts/custom-hunts.json");
  }
  for (const entry of (await readJsonl(path.join(dataDir, "hunts", "submissions.jsonl"))) ?? []) {
    if ("corrupt" in entry) {
      quarantined.push({
        store: "hunt-submissions",
        id: `line-${entry.line}`,
        doc: { raw: entry.corrupt },
        errors: [{ message: `corrupt JSONL line ${entry.line}: ${entry.error}` }],
        where: "hunts/submissions.jsonl",
      });
      continue;
    }
    const sub = entry.value;
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      const rec = sub as Record<string, unknown>;
      const id = typeof rec.id === "string" && rec.id ? rec.id : submissionId(rec);
      takeRecord("hunt-submissions", { ...rec, id }, "hunts/submissions.jsonl");
    } else {
      quarantined.push({
        store: "hunt-submissions",
        id: `line-${entry.line}`,
        doc: null,
        errors: [{ message: `line ${entry.line} is not an object` }],
        where: "hunts/submissions.jsonl",
      });
    }
  }

  // Append logs.
  const appendSources: ["analytics_event" | "survey_response" | "ferry_observation", string][] = [
    ["analytics_event", path.join(dataDir, "analytics", "events.jsonl")],
    ["survey_response", path.join(dataDir, "ltac-responses.jsonl")],
    ["ferry_observation", path.join(dataDir, "ferry", "observations.jsonl")],
  ];
  const appendPlans: {
    table: (typeof appendSources)[number][0];
    file: string;
    rows: unknown[];
    corrupt: { line: number; error: string }[];
  }[] = [];
  for (const [table, file] of appendSources) {
    const lines = await readJsonl(file);
    if (lines === null) continue;
    const rows: unknown[] = [];
    const corrupt: { line: number; error: string }[] = [];
    for (const l of lines) {
      if ("corrupt" in l) corrupt.push({ line: l.line, error: l.error });
      else rows.push(l.value);
    }
    appendPlans.push({ table, file: path.relative(dataDir, file), rows, corrupt });
  }

  // Diff against the target.
  const existing = await readRecordRows();
  const byKey = new Map(existing.map((r) => [`${r.store} ${r.id}`, r]));

  const perStore: Record<string, StoreCounts> = {};
  const counts = (store: string): StoreCounts =>
    (perStore[store] ??= {
      total: 0,
      new: 0,
      changed: 0,
      unchanged: 0,
      tombstones: 0,
      quarantined: 0,
    });

  const toWrite: Incoming[] = [];
  for (const rec of incoming) {
    const c = counts(rec.store);
    c.total++;
    if (rec.deleted) c.tombstones++;
    const prior = byKey.get(`${rec.store} ${rec.id}`);
    if (!prior) {
      c.new++;
      toWrite.push(rec);
    } else if (
      stableStringify(prior.doc) !== stableStringify(rec.doc) ||
      prior.deleted !== rec.deleted
    ) {
      c.changed++;
      toWrite.push(rec);
    } else {
      c.unchanged++;
    }
  }
  for (const q of quarantined) {
    const c = counts(q.store);
    c.total++;
    c.quarantined++;
  }

  // Report.
  log(
    `import-data-dir: source ${dataDir} → target ${opts.host} (${opts.apply ? "APPLY" : "DRY RUN"})`,
  );
  log("");
  log("store                     total   new  changed  unchanged  tombstones  quarantined");
  for (const [store, c] of Object.entries(perStore).sort()) {
    log(
      `${store.padEnd(24)} ${String(c.total).padStart(6)} ${String(c.new).padStart(5)} ${String(c.changed).padStart(8)} ${String(c.unchanged).padStart(10)} ${String(c.tombstones).padStart(11)} ${String(c.quarantined).padStart(12)}`,
    );
  }

  const targetCounts = await countAppendRows();
  const appendReport: ImportResult["appendTables"] = {};
  log("");
  log("append table         source-rows  target-rows  corrupt-lines  action");
  for (const p of appendPlans) {
    const target = targetCounts[p.table];
    const willAppend = !(target > 0 && !opts.forceAppend);
    appendReport[p.table] = {
      source: p.rows.length,
      target,
      corrupt: p.corrupt.length,
      appended: false,
    };
    log(
      `${p.table.padEnd(20)} ${String(p.rows.length).padStart(11)} ${String(target).padStart(12)} ${String(p.corrupt.length).padStart(13)}  ${willAppend ? "append" : "SKIP (target non-empty; --force-append to override)"}`,
    );
  }

  const corruptLineCount = appendPlans.reduce((n, p) => n + p.corrupt.length, 0);
  if (quarantined.length > 0 || corruptLineCount > 0) {
    log("");
    log("QUARANTINE");
    for (const q of quarantined) {
      log(`  [${q.store}] ${q.id} (${q.where}): ${JSON.stringify(q.errors)}`);
    }
    for (const p of appendPlans) {
      for (const c of p.corrupt) log(`  [${p.table}] ${p.file} line ${c.line}: ${c.error}`);
    }
  }

  const exitCode: 0 | 2 = quarantined.length > 0 || corruptLineCount > 0 ? 2 : 0;
  const result: ImportResult = {
    exitCode,
    perStore,
    written: 0,
    quarantined: quarantined.map(({ store, id, where, errors }) => ({ store, id, where, errors })),
    appendTables: appendReport,
  };

  if (!opts.apply) {
    log("");
    log(`Would write ${toWrite.length} record(s). DRY RUN — no writes performed`);
    return result;
  }

  const ok = await opts.confirm(
    opts.host,
    `${toWrite.length} record write(s), ${quarantined.length} quarantine(s), ${appendPlans.length} append table(s)`,
  );
  if (!ok) {
    log("Confirmation failed — aborting with no writes.");
    return { ...result, aborted: true };
  }

  // Structured records — through the exact writeRecord path (one 'import'
  // audit row per created/changed record; unchanged rows already skipped).
  for (const rec of toWrite) {
    await writeRecord(
      rec.store,
      { ...(rec.doc as { id: string }), ...(rec.deleted ? { _deleted: true as const } : {}) },
      IMPORT_META,
    );
  }
  result.written = toWrite.length;

  // Quarantined records — parked, never written to `record`.
  for (const q of quarantined) {
    await insertQuarantineRow({ store: q.store, id: q.id, doc: q.doc, errors: q.errors });
  }

  // Append tables — INSERT-only, run-once guarded.
  for (const p of appendPlans) {
    const target = targetCounts[p.table];
    if (target > 0 && !opts.forceAppend) continue;
    const insert =
      p.table === "analytics_event"
        ? appendAnalyticsEvent
        : p.table === "survey_response"
          ? appendSurveyResponse
          : appendFerryObservation;
    for (const row of p.rows) await insert(row);
    appendReport[p.table].appended = true;
  }

  const after = await countAppendRows();
  log("");
  log(
    `Applied: ${toWrite.length} record write(s), ${quarantined.length} quarantined, append rows now ` +
      `analytics=${after.analytics_event} survey=${after.survey_response} ferry=${after.ferry_observation}.`,
  );
  return result;
}
