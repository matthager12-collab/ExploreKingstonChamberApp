// GrowthZone roster importer (E16 landing-zone slice) — CSV in, directory
// drafts out, through the SAME planner/apply machinery as the Qwick importer
// (src/lib/import/qwick.ts): one precedence law, two principals. This module
// owns every GrowthZone-shape assumption: CSV parsing, header synonyms,
// status filtering, category vocabulary, address assembly.
//
// Input is a CSV an operator exports from GrowthZone's member reports — the
// agent-operable boundary docs/ROLLOFF-GROWTHZONE.md prescribes. The app
// never talks to the GrowthZone API (ADR-0002: no API purchase). The exact
// column set varies by which report the operator ran, so column resolution
// is synonym-driven with per-run overrides and a preflight report instead of
// a fixed schema: an unexpected export needs a --map flag, not a code change.
//
// PRECEDENCE: records this importer created and no human has touched carry
// (source='import', updated_by='import:growthzone') and may be refreshed by
// a re-run. EVERYTHING else — curated seeds, admin records, claimed records,
// records the QWICK importer owns — is local-wins, exactly as qwick.ts
// documents. The two importers can never write over each other because the
// refresh discriminator includes the principal.
//
// SCOPE GUARD: this is the listings LANDING ZONE only. It creates claimable
// directory drafts; it is NOT the E16 member store / entitlements migration
// (membership levels, dues, contacts stay OUT of the app database — see
// buildContactsCsv, which hands them back to the operator as a file).

import {
  applyQwickPlan,
  DESCRIPTION_CAP,
  normalizeName,
  normalizePhone,
  normalizeWebsiteHost,
  persistDryRun,
  planQwickImport,
  stripHtml,
  type AliasRecord,
  type ApplyResult,
  type ImportSourceConfig,
  type LocalRecord,
  type NormalizeResult,
  type QwickPlan,
} from "./qwick";
import { listImportRunRows } from "../db/import-store";
import { mapGrowthZoneCategories, unmappedGrowthZoneCategories } from "./gz-category-map";

/** Alias/import_run namespace for this importer. */
export const GROWTHZONE_SOURCE = "growthzone";

/** Audit principal for every record write — ALSO the refresh discriminator
 *  (precedence law), so never change it casually. Distinct from the Qwick
 *  principal by design: neither importer may refresh the other's records. */
export const GROWTHZONE_PRINCIPAL = "import:growthzone";

/* ------------------------------- CSV ---------------------------------- */

/** RFC 4180 parser, hand-rolled (charter forbids a dependency for this):
 *  quoted fields, escaped quotes (""), embedded commas/newlines, CRLF or LF,
 *  a UTF-8 BOM on the first cell, trailing blank lines. Returns raw cell
 *  rows; header semantics live in rosterFromCsv. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully-empty trailing rows (a final newline is not a record).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* --------------------------- column mapping ---------------------------- */

/** Header comparison key: lowercase, punctuation → space, collapsed. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const GZ_FIELDS = [
  "externalId",
  "name",
  "status",
  "level",
  "phone",
  "email",
  "website",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "categories",
  "description",
  "rep",
] as const;
export type GzField = (typeof GZ_FIELDS)[number];

/** Synonyms per field, in priority order, compared via normalizeHeader.
 *  Sourced from GrowthZone/ChamberMaster report vocabulary; extend freely —
 *  a miss is recoverable at run time with --map field="Actual Header". */
const FIELD_SYNONYMS: Record<GzField, string[]> = {
  name: [
    "member name",
    "company name",
    "company",
    "organization name",
    "organization",
    "business name",
    "account name",
    "name",
  ],
  externalId: [
    "member id",
    "membership id",
    "account number",
    "account id",
    "member number",
    "growthzone id",
    "id",
  ],
  status: ["membership status", "member status", "status"],
  level: ["membership level", "membership type", "member type", "level", "membership"],
  phone: [
    "phone",
    "work phone",
    "primary phone",
    "phone number",
    "main phone",
    "business phone",
    "office phone",
  ],
  email: ["email", "primary email", "email address", "business email", "contact email"],
  website: ["website", "web site", "website url", "web address", "url", "website address"],
  address1: [
    "address 1",
    "address line 1",
    "address",
    "street address",
    "physical address",
    "mailing address",
    "address1",
  ],
  address2: ["address 2", "address line 2", "address2", "suite", "unit"],
  city: ["city", "physical city", "mailing city"],
  state: ["state", "state province", "province", "physical state", "mailing state"],
  zip: ["zip", "zip code", "postal code", "physical zip", "mailing zip", "zip postal code"],
  categories: [
    "categories",
    "business categories",
    "directory categories",
    "category",
    "business category",
    "quicklink categories",
    "list categories",
  ],
  description: [
    "description",
    "directory description",
    "profile description",
    "about",
    "business description",
  ],
  rep: ["primary contact", "primary rep", "rep name", "contact name", "main contact", "contact"],
};

export type ColumnMapping = Partial<Record<GzField, string>>;

export type ColumnResolution = {
  /** field → the RAW header chosen from the file (overrides win). */
  mapping: ColumnMapping;
  /** Raw headers no field claimed — listed so nothing silently vanishes. */
  unmappedHeaders: string[];
  /** Overrides that named a header the file does not contain. */
  badOverrides: string[];
};

/** Resolve fields → file headers. `overrides` (from --map flags) name RAW
 *  headers and win over synonyms; both sides compare via normalizeHeader. */
export function resolveColumns(
  headers: string[],
  overrides: ColumnMapping = {},
): ColumnResolution {
  const byKey = new Map<string, string>();
  for (const h of headers) {
    const key = normalizeHeader(h);
    // First occurrence wins; duplicate headers in an export are rare and the
    // preflight's unmapped list makes the loser visible.
    if (key && !byKey.has(key)) byKey.set(key, h);
  }
  const mapping: ColumnMapping = {};
  const badOverrides: string[] = [];
  const claimed = new Set<string>();
  for (const field of GZ_FIELDS) {
    const override = overrides[field];
    if (override !== undefined) {
      const hit = byKey.get(normalizeHeader(override));
      if (hit === undefined) {
        badOverrides.push(`${field}=${override}`);
      } else {
        mapping[field] = hit;
        claimed.add(hit);
      }
      continue;
    }
    for (const synonym of FIELD_SYNONYMS[field]) {
      const hit = byKey.get(synonym);
      if (hit !== undefined && !claimed.has(hit)) {
        mapping[field] = hit;
        claimed.add(hit);
        break;
      }
    }
  }
  return {
    mapping,
    unmappedHeaders: headers.filter((h) => !claimed.has(h)),
    badOverrides,
  };
}

/* ----------------------------- normalize ------------------------------- */

/** Placeholder values operators type into empty roster cells — treated as
 *  absent so "N/A" never becomes a phone number or a website host. */
const JUNK_VALUES = new Set(["n/a", "na", "none", "-", "--", "tbd", "unknown", "."]);

function cellValue(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v || JUNK_VALUES.has(v.toLowerCase())) return undefined;
  return v;
}

export type GzRow = Record<string, string>;

/** External id for a row: the mapped id column when present, else a stable
 *  name-derived key ("name:<nameKey>"). The fallback keeps re-runs
 *  idempotent, but renames then read as delete+create — the preflight warns
 *  when it is in effect so the operator can include the id column instead. */
export function gzExternalId(row: GzRow, mapping: ColumnMapping): string | undefined {
  const fromId = cellValue(mapping.externalId ? row[mapping.externalId] : undefined);
  if (fromId) return `gz-${fromId}`;
  const name = cellValue(mapping.name ? row[mapping.name] : undefined);
  const nameKey = name ? normalizeName(name) : "";
  return nameKey ? `name:${nameKey}` : undefined;
}

/** Build the planner's normalizer for one resolved mapping. Mirrors
 *  normalizeQwickRow's contract: never throws; a bad row quarantines alone. */
export function makeGrowthZoneNormalizer(
  mapping: ColumnMapping,
): (raw: unknown) => NormalizeResult {
  const get = (row: GzRow, field: GzField) => {
    const header = mapping[field];
    return header === undefined ? undefined : cellValue(row[header]);
  };
  return (raw: unknown): NormalizeResult => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, reason: "row is not an object" };
    }
    const row = raw as GzRow;
    const externalId = gzExternalId(row, mapping);
    const name = get(row, "name");
    if (!name) return { ok: false, reason: "row has no name", externalId };
    // externalId is defined whenever name is (name-key fallback).
    const id = externalId!;

    const phone = get(row, "phone");
    const rawWebsite = get(row, "website");
    const websiteHost = rawWebsite ? normalizeWebsiteHost(rawWebsite) || undefined : undefined;
    // Same canonicalization rule as Qwick: scheme-less values get https://,
    // unparseable values are dropped (they would only fail validation later).
    const website = rawWebsite
      ? websiteHost
        ? /^https?:\/\//i.test(rawWebsite)
          ? rawWebsite
          : `https://${rawWebsite}`
        : undefined
      : undefined;

    const sourceCategories = (get(row, "categories") ?? "")
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const addressParts = [
      get(row, "address1"),
      get(row, "address2"),
      get(row, "city"),
      [get(row, "state"), get(row, "zip")].filter(Boolean).join(" "),
    ].filter((part): part is string => Boolean(part));
    const address = addressParts.length ? addressParts.join(", ") : undefined;

    // A roster is authoritative for membership, not for prose: only a
    // non-empty description cell carries one (it can contain HTML); absent
    // column, blank cell, and junk all mean "keep whatever exists".
    const rawDescription = get(row, "description");
    const description = rawDescription
      ? stripHtml(rawDescription).slice(0, DESCRIPTION_CAP) || undefined
      : undefined;

    return {
      ok: true,
      candidate: {
        externalId: id,
        name,
        nameKey: normalizeName(name),
        ...(description !== undefined ? { description } : {}),
        phone,
        phoneDigits: phone ? normalizePhone(phone) || undefined : undefined,
        website,
        websiteHost,
        sourceCategories,
        isPromoted: false,
        category: mapGrowthZoneCategories(sourceCategories),
        ...(address ? { address } : {}),
      },
    };
  };
}

/* --------------------------- status filter ----------------------------- */

export const DEFAULT_INCLUDE_STATUSES = ["active"];

/** A row is included when its normalized status starts with any include
 *  token ("Active", "Active - Courtesy", "ACTIVE" all pass "active"). With
 *  no status column mapped, everything is included and the preflight warns. */
export function statusIncluded(status: string | undefined, includeTokens: string[]): boolean {
  if (status === undefined) return true;
  const normalized = status.trim().toLowerCase();
  return includeTokens.some((token) => normalized.startsWith(token.trim().toLowerCase()));
}

/* ------------------------------ preflight ------------------------------ */

export type GzPreflight = {
  totalRows: number;
  includedRows: number;
  mapping: ColumnMapping;
  unmappedHeaders: string[];
  badOverrides: string[];
  /** Distinct raw status values with counts, included and excluded alike. */
  statusCounts: Record<string, number>;
  /** True when no status column resolved — nothing was filtered. */
  statusColumnMissing: boolean;
  /** True when no id column resolved — external ids fall back to name keys. */
  externalIdFallback: boolean;
  /** Distinct unmapped category strings with counts (map-extension list). */
  unmappedCategories: Record<string, number>;
  rowsMissingName: number;
};

export type GzRoster = {
  /** Rows that passed the status filter — the planner's input. */
  rows: GzRow[];
  preflight: GzPreflight;
  resolution: ColumnResolution;
};

/** Parse a GrowthZone CSV export into planner-ready rows + the preflight
 *  report. Throws only on structural failure (no header row / no name
 *  column) — everything row-level degrades into the report instead. */
export function rosterFromCsv(
  text: string,
  options: { overrides?: ColumnMapping; includeStatuses?: string[] } = {},
): GzRoster {
  const cells = parseCsv(text);
  if (cells.length === 0) throw new Error("CSV is empty — no header row found.");
  const [headerRow, ...dataRows] = cells;
  const headers = headerRow.map((h) => h.trim());
  const resolution = resolveColumns(headers, options.overrides ?? {});
  const { mapping } = resolution;
  if (mapping.name === undefined) {
    throw new Error(
      `No name column found. Headers seen: ${headers.join(", ") || "(none)"}. ` +
        'Point at the right one with --map name="Header Name".',
    );
  }

  const includeTokens = options.includeStatuses ?? DEFAULT_INCLUDE_STATUSES;
  const statusColumnMissing = mapping.status === undefined;

  const rows: GzRow[] = [];
  const statusCounts: Record<string, number> = {};
  const unmappedCategories: Record<string, number> = {};
  let rowsMissingName = 0;

  for (const line of dataRows) {
    const row: GzRow = {};
    headers.forEach((h, i) => {
      row[h] = line[i] ?? "";
    });
    const status = mapping.status ? (cellValue(row[mapping.status]) ?? "(blank)") : undefined;
    if (status !== undefined) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (!statusIncluded(status, includeTokens)) continue;

    if (!cellValue(row[mapping.name])) rowsMissingName += 1;
    const categories = (cellValue(mapping.categories ? row[mapping.categories] : undefined) ?? "")
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const miss of unmappedGrowthZoneCategories(categories)) {
      unmappedCategories[miss] = (unmappedCategories[miss] ?? 0) + 1;
    }
    rows.push(row);
  }

  return {
    rows,
    resolution,
    preflight: {
      totalRows: dataRows.length,
      includedRows: rows.length,
      mapping,
      unmappedHeaders: resolution.unmappedHeaders,
      badOverrides: resolution.badOverrides,
      statusCounts,
      statusColumnMissing,
      externalIdFallback: mapping.externalId === undefined,
      unmappedCategories,
      rowsMissingName,
    },
  };
}

/* ------------------------------ plan/apply ----------------------------- */

export function growthZoneConfig(mapping: ColumnMapping): ImportSourceConfig {
  return {
    source: GROWTHZONE_SOURCE,
    principal: GROWTHZONE_PRINCIPAL,
    normalizeRow: makeGrowthZoneNormalizer(mapping),
  };
}

export function planGrowthZoneImport(
  roster: GzRoster,
  local: LocalRecord[],
  aliases: AliasRecord[],
): QwickPlan {
  return planQwickImport(roster.rows, local, aliases, growthZoneConfig(roster.preflight.mapping));
}

export async function persistGrowthZoneDryRun(
  plan: QwickPlan,
  runBy: string,
): Promise<ApplyResult> {
  return persistDryRun(plan, runBy, GROWTHZONE_SOURCE);
}

export async function applyGrowthZonePlan(
  plan: QwickPlan,
  runBy: string = GROWTHZONE_PRINCIPAL,
): Promise<ApplyResult> {
  return applyQwickPlan(plan, GROWTHZONE_PRINCIPAL, runBy, GROWTHZONE_SOURCE);
}

export async function listGrowthZoneImportRuns(limit = 20) {
  return listImportRunRows(GROWTHZONE_SOURCE, limit);
}

/* ----------------------------- contacts out ---------------------------- */

/** RFC-4180 field escaping (same rule as scripts/mint-invites.ts). */
function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The operator-side join file: listing id ↔ member contact columns, for
 *  invite mail-merges. This is the deliberate seam that keeps member PII
 *  (emails, reps, levels) OUT of the app database while still making
 *  "email every imported business its claim link" a spreadsheet exercise.
 *  Derived purely from the plan + the source CSV — no database read. */
export function buildContactsCsv(plan: QwickPlan, roster: GzRoster): string {
  const { mapping } = roster.preflight;
  const rowByExternalId = new Map<string, GzRow>();
  for (const row of roster.rows) {
    const id = gzExternalId(row, mapping);
    if (id !== undefined && !rowByExternalId.has(id)) rowByExternalId.set(id, row);
  }
  const get = (row: GzRow | undefined, field: GzField) =>
    row === undefined ? "" : (cellValue(mapping[field] ? row[mapping[field]!] : undefined) ?? "");

  const lines = ["bucket,store,listing_id,name,email,phone,level,rep"];
  const push = (
    bucket: string,
    store: string,
    listingId: string,
    name: string,
    externalId: string,
  ) => {
    const row = rowByExternalId.get(externalId);
    lines.push(
      [
        bucket,
        store,
        listingId,
        name,
        get(row, "email"),
        get(row, "phone"),
        get(row, "level"),
        get(row, "rep"),
      ]
        .map(csvField)
        .join(","),
    );
  };

  for (const c of plan.created) push("created", "directory", c.record.id, c.record.name, c.externalId);
  for (const u of plan.updated) push("updated", u.store, u.id, u.record.name, u.externalId);
  for (const m of plan.matched) push("matched", m.store, m.id, m.name, m.externalId);
  for (const un of plan.unchanged) {
    const row = rowByExternalId.get(un.externalId);
    const name = get(row, "name");
    push("unchanged", un.store, un.id, name, un.externalId);
  }
  return lines.join("\n") + "\n";
}
