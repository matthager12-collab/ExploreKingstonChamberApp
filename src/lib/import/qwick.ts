// E17 Qwick listings importer — fetch, normalize, plan, apply, all in ONE
// module so every vendor-shape assumption is a one-file fix (charter rule).
//
// Vendor ground truth (updated 2026-08-01): the public GraphQL read at
// node.qwickmedia.com stopped resolving (the Heroku DNS targets are gone and
// the vendor's site decayed to a WordPress-signup placeholder), so the
// network path below is KEPT for the case the service resurrects, but the
// operative input is a saved export via the CLI's --fixture flag. CI never
// performs live network calls either way — tests run on fixtures.
//
// THE PRECEDENCE LAW (the heart of the epic): an import write may only ever
// touch a record this importer itself created and no human has touched
// since. Concretely, a local record is importer-owned iff its governance row
// says source === 'import' AND updated_by === 'import:qwick' AND
// owner_org_id is null AND it is not tombstoned. Everything else —
// curated seeds (no overlay row, or source 'seed'), admin-created records,
// claimed records, admin-edited or admin-published imports (setRecordStatus
// stamps updated_by), E16 GrowthZone-migrated records ('import' source but a
// different principal), tombstones — is LOCAL-WINS: the importer writes
// nothing, ever, and field differences go into the run report for a human.
//
// Read-only vendor contract: the single exported GraphQL document below is a
// `query`; no mutation document may ever exist in src/lib/import (CI gate in
// tests/unit/qwick-guards.test.ts), and no vendor auth/session code path
// exists here — the read was public by design.

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../db/client";
import { importRun, listingAlias } from "../db/import-schema";
import { readRecordRows, writeRecord, type RecordStatus } from "../db/records";
import { validateRecord } from "../db/store-schemas";
import { charities as charitySeed } from "../data/charities";
import { lodging as lodgingSeed } from "../data/lodging";
import { restaurants as restaurantSeed } from "../data/restaurants";
import type { DirectoryListing } from "../types";
import { mapQwickCategories } from "./qwick-category-map";

/** Both documented config constants (env override, checked-in default).
 *  These are NOT secrets — the read was public by vendor design. */
export const QWICK_GRAPHQL_URL =
  process.env.QWICK_GRAPHQL_URL ?? "https://node.qwickmedia.com/graphql";
export const QWICK_LICENSE_ID =
  process.env.QWICK_LICENSE_ID ?? "ea8ac2ea-b34c-4ced-8f39-d208ce71babf";

/** The importer's ONLY GraphQL document (read-only `query`; guard-tested).
 *  phone/website field names are bundle-recovered best guesses that could
 *  never be probe-confirmed (vendor died first) — normalizeQwickRow treats
 *  them as optional, so a shape miss degrades matching, not the run. */
export const IMPORT_QUERY_DOCUMENT = `query {
  signByLicense(licenseId: "${QWICK_LICENSE_ID}") {
    DataCollection {
      Data {
        id
        name
        description
        qr
        logo
        listingImage
        isPromoted
        categories
        customCategories
        phone
        website
      }
    }
  }
}`;

/** Audit principal for every importer write — ALSO the refresh discriminator
 *  (see the precedence law above), so never change it casually. */
export const IMPORT_PRINCIPAL = "import:qwick";

export const IMPORT_SOURCE = "qwick";

/* ------------------------------ envelope ------------------------------ */

/** Envelope only — per-row validation happens in normalizeQwickRow so one
 *  malformed row quarantines alone instead of failing the whole parse. */
const envelopeSchema = z.object({
  data: z.object({
    signByLicense: z.object({
      DataCollection: z.object({
        Data: z.array(z.unknown()),
      }),
    }),
  }),
});

/** Accept either a saved raw GraphQL response (the envelope) or a bare rows
 *  array — operator exports have circulated in both shapes. */
export function rowsFromExport(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  const envelope = envelopeSchema.safeParse(parsed);
  if (envelope.success) return envelope.data.data.signByLicense.DataCollection.Data;
  throw new Error(
    "Unrecognized export shape: expected the raw GraphQL response envelope or a JSON array of listing rows.",
  );
}

export async function fetchQwickListings(
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const res = await fetchImpl(QWICK_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: IMPORT_QUERY_DOCUMENT }),
  });
  if (!res.ok) throw new Error(`Qwick GraphQL read failed: HTTP ${res.status}`);
  return rowsFromExport(await res.json());
}

/* ------------------------------ normalize ------------------------------ */

const rowSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number()]).transform(String),
  name: z.string().min(1, "row has no name"),
  description: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  listingImage: z.string().optional().nullable(),
  isPromoted: z.boolean().optional().nullable(),
  categories: z.array(z.string()).optional().nullable(),
  customCategories: z.array(z.string()).optional().nullable(),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
});

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#039;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Hand-rolled HTML → plain text (charter forbids a dependency for this):
 *  drop script/style bodies, break on block-ish tags, strip the rest,
 *  decode the basic entities, collapse whitespace. Output is only ever
 *  rendered as React text nodes. */
export function stripHtml(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#0?39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return n >= 32 && n < 0x10ffff ? String.fromCodePoint(n) : " ";
    });
  return text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Match key: lowercase, diacritics stripped, punctuation dropped,
 *  whitespace collapsed, leading "the " removed. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

/** Digits only; a leading US country code is dropped so 1-360… matches 360…. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** Lowercased host with any www. prefix dropped; "" when unparseable. */
export function normalizeWebsiteHost(url: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function slugify(name: string): string {
  const slug = normalizeName(name).replace(/\s+/g, "-").slice(0, 64).replace(/-+$/, "");
  return slug || "listing";
}

export const DESCRIPTION_CAP = 2000;

export type QwickCandidate = {
  externalId: string;
  name: string;
  nameKey: string;
  description: string;
  phone?: string;
  phoneDigits?: string;
  website?: string;
  websiteHost?: string;
  sourceCategories: string[];
  sourceImages?: { logo?: string; listingImage?: string };
  isPromoted: boolean;
};

export type NormalizeResult =
  | { ok: true; candidate: QwickCandidate }
  | { ok: false; reason: string; externalId?: string; name?: string };

export function normalizeQwickRow(raw: unknown): NormalizeResult {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    const maybe = (raw ?? {}) as { id?: unknown; name?: unknown };
    return {
      ok: false,
      reason: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(row)"}: ${i.message}`)
        .join("; "),
      externalId: typeof maybe.id === "string" || typeof maybe.id === "number" ? String(maybe.id) : undefined,
      name: typeof maybe.name === "string" ? maybe.name : undefined,
    };
  }
  const row = parsed.data;
  const name = row.name.trim();
  if (!name) return { ok: false, reason: "row has no name", externalId: row.id };
  const phone = row.phone?.trim() || undefined;
  // Kiosk operators saved scheme-less websites; canonicalize so the value
  // clears the directory schema's http(s) rule. Unparseable → dropped (the
  // raw value would only fail validation downstream anyway).
  const rawWebsite = row.website?.trim() || undefined;
  const websiteHost = rawWebsite ? normalizeWebsiteHost(rawWebsite) || undefined : undefined;
  const website = rawWebsite
    ? websiteHost
      ? /^https?:\/\//i.test(rawWebsite)
        ? rawWebsite
        : `https://${rawWebsite}`
      : undefined
    : undefined;
  const logo = row.logo?.trim() || undefined;
  const listingImage = row.listingImage?.trim() || undefined;
  const sourceCategories = [
    ...(row.categories ?? []),
    ...(row.customCategories ?? []),
  ]
    .map((c) => c.trim())
    .filter(Boolean);
  return {
    ok: true,
    candidate: {
      externalId: row.id,
      name,
      nameKey: normalizeName(name),
      description: stripHtml(row.description ?? "").slice(0, DESCRIPTION_CAP),
      phone,
      phoneDigits: phone ? normalizePhone(phone) || undefined : undefined,
      website,
      websiteHost,
      sourceCategories,
      sourceImages: logo || listingImage ? { logo, listingImage } : undefined,
      isPromoted: Boolean(row.isPromoted),
    },
  };
}

/* ------------------------------- planning ------------------------------ */

/** A local record as the policy engine sees it. `governance === null` means
 *  seed-only (a git-curated record with no overlay row) — always local-wins. */
export type LocalRecord = {
  store: string;
  id: string;
  name: string;
  phone?: string;
  website?: string;
  doc: Record<string, unknown>;
  governance: {
    source: string;
    ownerOrgId: string | null;
    updatedBy: string | null;
    status: RecordStatus;
    deleted: boolean;
  } | null;
};

export type AliasRecord = {
  source: string;
  externalId: string;
  subjectStore: string;
  subjectId: string;
};

export type FieldDiff = { field: string; local: unknown; upstream: unknown };

export type QwickPlan = {
  created: { externalId: string; record: DirectoryListing }[];
  updated: {
    externalId: string;
    store: string;
    id: string;
    status: RecordStatus;
    record: DirectoryListing;
    diffs: FieldDiff[];
  }[];
  unchanged: { externalId: string; store: string; id: string }[];
  /** Local-wins resolutions: curated/claimed/admin-touched records the
   *  importer will never write. Field diffs are for hand-verification. */
  matched: {
    externalId: string;
    store: string;
    id: string;
    name: string;
    aliasNew: boolean;
    diffs: FieldDiff[];
  }[];
  quarantined: {
    externalId?: string;
    name?: string;
    reason: string;
    candidateIds?: string[];
  }[];
  deletedUpstream: { externalId: string; store: string; id: string }[];
};

export function planStats(plan: QwickPlan): Record<string, number> {
  return {
    created: plan.created.length,
    updated: plan.updated.length,
    unchanged: plan.unchanged.length,
    matched: plan.matched.length,
    quarantined: plan.quarantined.length,
    deletedUpstream: plan.deletedUpstream.length,
  };
}

function isImporterOwned(local: LocalRecord): boolean {
  const g = local.governance;
  return Boolean(
    g && !g.deleted && !g.ownerOrgId && g.source === "import" && g.updatedBy === IMPORT_PRINCIPAL,
  );
}

/** Fields the importer may refresh on its own records, compared for the
 *  unchanged/updated split and reported as diffs on local-wins matches. */
function candidateFields(c: QwickCandidate): Record<string, unknown> {
  return {
    name: c.name,
    description: c.description,
    phone: c.phone,
    website: c.website,
  };
}

function diffAgainstLocal(local: LocalRecord, c: QwickCandidate): FieldDiff[] {
  const upstream = candidateFields(c);
  const diffs: FieldDiff[] = [];
  for (const [field, upstreamValue] of Object.entries(upstream)) {
    if (upstreamValue === undefined) continue;
    const localValue = local.doc[field];
    if (localValue !== upstreamValue) diffs.push({ field, local: localValue, upstream: upstreamValue });
  }
  return diffs;
}

function buildDirectoryRecord(id: string, c: QwickCandidate, previous?: Record<string, unknown>): DirectoryListing {
  const record: DirectoryListing = {
    id,
    name: c.name,
    category: mapQwickCategories(c.sourceCategories),
    description: c.description,
    tags: [],
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.website ? { website: c.website } : {}),
    ...(c.sourceCategories.length ? { sourceCategories: c.sourceCategories } : {}),
    ...(c.sourceImages ? { sourceImages: c.sourceImages } : {}),
  };
  // A refresh keeps values the upstream feed cannot express (tags, address —
  // importer-owned records can only have gotten them from this importer, but
  // stay conservative and never drop what exists).
  if (previous) {
    if (Array.isArray(previous.tags)) record.tags = previous.tags as string[];
    if (typeof previous.address === "string" && previous.address) record.address = previous.address;
  }
  return record;
}

/** The policy engine: deterministic, side-effect-free (charter step 3).
 *  `local` must be the union of ALL local domains' records — seeds included —
 *  with governance metadata attached where an overlay row exists. */
export function planQwickImport(
  rows: unknown[],
  local: LocalRecord[],
  aliases: AliasRecord[],
): QwickPlan {
  const plan: QwickPlan = {
    created: [],
    updated: [],
    unchanged: [],
    matched: [],
    quarantined: [],
    deletedUpstream: [],
  };

  const localById = new Map<string, LocalRecord>();
  const byNameKey = new Map<string, LocalRecord[]>();
  const byPhone = new Map<string, LocalRecord[]>();
  const byHost = new Map<string, LocalRecord[]>();
  const push = (map: Map<string, LocalRecord[]>, key: string, rec: LocalRecord) => {
    const list = map.get(key);
    if (list) list.push(rec);
    else map.set(key, [rec]);
  };
  for (const rec of local) {
    localById.set(`${rec.store}/${rec.id}`, rec);
    const nameKey = normalizeName(rec.name);
    if (nameKey) push(byNameKey, nameKey, rec);
    if (rec.phone) {
      const digits = normalizePhone(rec.phone);
      if (digits) push(byPhone, digits, rec);
    }
    if (rec.website) {
      const host = normalizeWebsiteHost(rec.website);
      if (host) push(byHost, host, rec);
    }
  }

  const aliasByExternal = new Map<string, AliasRecord>();
  for (const a of aliases) {
    if (a.source === IMPORT_SOURCE) aliasByExternal.set(a.externalId, a);
  }

  // Two upstream rows normalizing to the same name are ambiguous by charter.
  const nameKeyCounts = new Map<string, number>();
  const normalized: NormalizeResult[] = rows.map(normalizeQwickRow);
  for (const r of normalized) {
    if (r.ok) {
      nameKeyCounts.set(r.candidate.nameKey, (nameKeyCounts.get(r.candidate.nameKey) ?? 0) + 1);
    }
  }

  const usedIds = new Set(local.filter((l) => l.store === "directory").map((l) => l.id));
  const seenExternalIds = new Set<string>();

  const resolveTo = (c: QwickCandidate, target: LocalRecord, aliasNew: boolean) => {
    if (isImporterOwned(target)) {
      const record = buildDirectoryRecord(target.id, c, target.doc);
      const diffs = diffAgainstLocal(target, c);
      if (diffs.length === 0) {
        plan.unchanged.push({ externalId: c.externalId, store: target.store, id: target.id });
      } else {
        plan.updated.push({
          externalId: c.externalId,
          store: target.store,
          id: target.id,
          status: target.governance?.status ?? "draft",
          record,
          diffs,
        });
      }
    } else {
      plan.matched.push({
        externalId: c.externalId,
        store: target.store,
        id: target.id,
        name: target.name,
        aliasNew,
        diffs: diffAgainstLocal(target, c),
      });
    }
  };

  for (const result of normalized) {
    if (!result.ok) {
      plan.quarantined.push({
        externalId: result.externalId,
        name: result.name,
        reason: result.reason,
      });
      continue;
    }
    const c = result.candidate;
    seenExternalIds.add(c.externalId);

    // (a) alias hit — already resolved; never re-guess.
    const alias = aliasByExternal.get(c.externalId);
    if (alias) {
      const target = localById.get(`${alias.subjectStore}/${alias.subjectId}`);
      if (!target) {
        plan.quarantined.push({
          externalId: c.externalId,
          name: c.name,
          reason: `alias points at missing record ${alias.subjectStore}/${alias.subjectId}`,
        });
        continue;
      }
      resolveTo(c, target, false);
      continue;
    }

    // Upstream-side ambiguity: duplicate normalized names in the feed.
    if ((nameKeyCounts.get(c.nameKey) ?? 0) > 1) {
      plan.quarantined.push({
        externalId: c.externalId,
        name: c.name,
        reason: "two upstream rows normalize to the same name — a human decides",
      });
      continue;
    }

    // (b) match: normalized name, else phone, else website host.
    const matches =
      byNameKey.get(c.nameKey) ??
      (c.phoneDigits ? byPhone.get(c.phoneDigits) : undefined) ??
      (c.websiteHost ? byHost.get(c.websiteHost) : undefined) ??
      [];
    if (matches.length > 1) {
      plan.quarantined.push({
        externalId: c.externalId,
        name: c.name,
        reason: "matches more than one local record — a human decides",
        candidateIds: matches.map((m) => `${m.store}/${m.id}`),
      });
      continue;
    }
    if (matches.length === 1) {
      resolveTo(c, matches[0], true);
      continue;
    }

    // (f) new — always lands in the directory domain as a draft.
    let id = slugify(c.name);
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    usedIds.add(id);
    plan.created.push({ externalId: c.externalId, record: buildDirectoryRecord(id, c) });
  }

  // (g) upstream deletions — report-only; the importer has no delete path.
  for (const [externalId, alias] of aliasByExternal) {
    if (!seenExternalIds.has(externalId)) {
      plan.deletedUpstream.push({
        externalId,
        store: alias.subjectStore,
        id: alias.subjectId,
      });
    }
  }

  return plan;
}

/* -------------------------------- reads -------------------------------- */

function localFromDoc(
  store: string,
  doc: Record<string, unknown>,
  governance: LocalRecord["governance"],
): LocalRecord {
  return {
    store,
    id: String(doc.id ?? ""),
    name: typeof doc.name === "string" ? doc.name : "",
    phone: typeof doc.phone === "string" ? doc.phone : undefined,
    website: typeof doc.website === "string" ? doc.website : undefined,
    doc,
    governance,
  };
}

/** The union read the planner needs: every record of every matchable domain —
 *  git seeds AND overlay rows of every status, tombstones included (a
 *  deliberately deleted record must match so the importer neither recreates
 *  nor resurrects it), with governance metadata attached. */
export async function readLocalRecords(): Promise<LocalRecord[]> {
  const seedSets: [string, { id: string }[]][] = [
    ["restaurants", restaurantSeed],
    ["lodging", lodgingSeed],
    ["charities", charitySeed],
    ["directory", []],
  ];
  const out: LocalRecord[] = [];
  for (const [store, seeds] of seedSets) {
    const rows = await readRecordRows(store);
    const rowById = new Map(rows.map((r) => [r.id, r]));
    for (const seed of seeds) {
      if (!rowById.has(seed.id)) {
        out.push(localFromDoc(store, seed as unknown as Record<string, unknown>, null));
      }
    }
    for (const row of rows) {
      out.push(
        localFromDoc(store, row.doc, {
          source: row.source,
          ownerOrgId: row.ownerOrgId,
          updatedBy: row.updatedBy,
          status: row.status,
          deleted: row.deleted,
        }),
      );
    }
  }
  return out;
}

export async function readAliases(): Promise<AliasRecord[]> {
  const db = getDb();
  const rows = await db.select().from(listingAlias);
  return rows.map((r) => ({
    source: r.source,
    externalId: r.externalId,
    subjectStore: r.subjectStore,
    subjectId: r.subjectId,
  }));
}

/* -------------------------------- apply -------------------------------- */

export type ApplyResult = {
  runId: string;
  stats: Record<string, number>;
};

async function persistRun(
  mode: "dry_run" | "apply",
  runBy: string,
  plan: QwickPlan,
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(importRun)
    .values({
      source: IMPORT_SOURCE,
      mode,
      finishedAt: new Date(),
      runBy,
      stats: planStats(plan),
      report: plan as unknown as Record<string, unknown>,
    })
    .returning({ id: importRun.id });
  return row.id;
}

/** Dry-run persistence: ONLY the import_run row (mode 'dry_run'). */
export async function persistDryRun(plan: QwickPlan, runBy: string): Promise<ApplyResult> {
  return { runId: await persistRun("dry_run", runBy, plan), stats: planStats(plan) };
}

/** Execute a plan through the store choke points (audit rows for free).
 *  Every record write validates against the strict directory schema BEFORE
 *  any write happens (all-or-nothing per charter: a malformed candidate must
 *  never partially write — validation failures should have quarantined at
 *  plan time, so a throw here is a bug, not data). */
export async function applyQwickPlan(
  plan: QwickPlan,
  principal: string = IMPORT_PRINCIPAL,
): Promise<ApplyResult> {
  // Pre-validate every planned write so a late failure can't half-apply.
  for (const entry of plan.created) {
    validateRecord("directory", entry.record as unknown as Record<string, unknown>);
  }
  for (const entry of plan.updated) {
    validateRecord(entry.store, entry.record as unknown as Record<string, unknown>);
  }

  const db = getDb();
  for (const entry of plan.created) {
    await writeRecord("directory", entry.record, {
      actor: principal,
      source: "import",
      status: "draft",
      externalId: entry.externalId,
      action: "import",
    });
    await db
      .insert(listingAlias)
      .values({
        source: IMPORT_SOURCE,
        externalId: entry.externalId,
        subjectStore: "directory",
        subjectId: entry.record.id,
        createdBy: principal,
      })
      .onConflictDoNothing();
  }
  for (const entry of plan.updated) {
    await writeRecord(entry.store, entry.record, {
      actor: principal,
      source: "import",
      // Preserve the row's current status — a refresh must never republish
      // or unpublish anything (writeRecord's upsert would otherwise reset it).
      status: entry.status,
      externalId: entry.externalId,
      action: "import",
    });
  }
  for (const entry of plan.matched) {
    if (!entry.aliasNew) continue;
    await db
      .insert(listingAlias)
      .values({
        source: IMPORT_SOURCE,
        externalId: entry.externalId,
        subjectStore: entry.store,
        subjectId: entry.id,
        createdBy: principal,
      })
      .onConflictDoNothing();
  }
  return { runId: await persistRun("apply", principal, plan), stats: planStats(plan) };
}

/** Past runs, newest first — the history read the admin surface lists. */
export async function listImportRuns(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(importRun)
    .where(eq(importRun.source, IMPORT_SOURCE))
    .orderBy(desc(importRun.startedAt))
    .limit(limit);
}
