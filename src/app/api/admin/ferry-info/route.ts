// Admin ferry-facts API — backs /admin/ferry-info. The structured payment /
// boarding-pass / cash / sources records that overlay src/lib/data/ferry-info.ts.
//
// GET  — admin: { records: [{ id, doc }, …] } for all four ids.
// POST — admin: { id, doc } where id is one of the four; the doc is rebuilt
//        from its known fields (so arbitrary JSON never reaches the overlay),
//        then saved.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  FERRY_INFO_IDS,
  getFerryInfoRecords,
  saveFerryInfoRecord,
  type BoardingPass,
  type FerryInfoId,
  type FerryPayment,
  type Source,
} from "@/lib/stores/ferry-info-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

const IDS = new Set<string>(FERRY_INFO_IDS);
const MAX_TEXT = 4000;

/* ------------------------------ small helpers ------------------------------ */

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Trim + cap a free-text field (keeps interior whitespace/newlines). */
function text(v: unknown): string {
  return (typeof v === "string" ? v : "").slice(0, MAX_TEXT);
}

/** Clean a string list: drop non-strings and blanks, trim each, cap length. */
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  return /^https?:\/\//.test(s) ? s : undefined;
}

function bad(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

/* ------------------------------ per-id builders ----------------------------- */
// Each rebuilds the record's doc from known fields only. Returns the clean doc,
// or a string error message.

function buildPayment(doc: Record<string, unknown>): FerryPayment | string {
  const methods = strList(doc.methods);
  if (methods.length === 0) return "payment needs at least one payment method";
  return {
    methods,
    kioskNote: text(doc.kioskNote),
    cashNote: text(doc.cashNote),
    surchargeNote: text(doc.surchargeNote),
    freeLegNote: text(doc.freeLegNote),
  };
}

function buildBoardingPass(doc: Record<string, unknown>): BoardingPass | string {
  const how = strList(doc.how);
  if (how.length === 0) return "boarding pass needs at least one step in \"how\"";
  return {
    summary: text(doc.summary),
    whenRequired: text(doc.whenRequired),
    where: text(doc.where),
    how,
    voids: text(doc.voids),
    exempt: text(doc.exempt),
    currentNote: text(doc.currentNote),
  };
}

function buildCashTips(doc: unknown): string[] | string {
  const tips = strList(doc);
  if (tips.length === 0) return "cash tips needs at least one tip";
  return tips;
}

function buildSources(doc: unknown): Source[] | string {
  if (!Array.isArray(doc)) return "sources must be a list";
  const out: Source[] = [];
  for (let i = 0; i < doc.length; i++) {
    const raw = doc[i];
    if (!raw || typeof raw !== "object") return `source ${i + 1} is malformed`;
    const s = raw as Record<string, unknown>;
    const label = str(s.label);
    const url = httpUrl(s.url);
    // Skip fully blank rows (the editor may leave a trailing empty one).
    if (!label && !url) continue;
    if (!label) return `source ${i + 1} needs a label`;
    if (!url) return `source ${i + 1} needs an http(s) URL`;
    out.push({ label, url });
  }
  if (out.length === 0) return "sources needs at least one entry";
  return out;
}

/* --------------------------------- handlers -------------------------------- */

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const records = await getFerryInfoRecords();
  return NextResponse.json({ records });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it for the audit actor.
  const actor = (await getSessionUser())!.email;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const id = str(body.id);
  if (!IDS.has(id)) {
    return bad(`id must be one of: ${FERRY_INFO_IDS.join(", ")}`);
  }
  if (body.doc === undefined || body.doc === null) return bad("doc required");

  const asObj = (): Record<string, unknown> =>
    typeof body.doc === "object" && !Array.isArray(body.doc)
      ? (body.doc as Record<string, unknown>)
      : {};

  let clean: unknown;
  if (id === "payment") clean = buildPayment(asObj());
  else if (id === "boarding-pass") clean = buildBoardingPass(asObj());
  else if (id === "cash-tips") clean = buildCashTips(body.doc);
  else clean = buildSources(body.doc);

  if (typeof clean === "string") return bad(clean);

  try {
    await saveFerryInfoRecord(id as FerryInfoId, clean, {
      actor,
      source: "admin",
    });
  } catch (err) {
    if (err instanceof RecordValidationError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ ok: true, id, doc: clean });
}
