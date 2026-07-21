// E11 privacy-request fulfillment (admin-only). The action side of the E08
// worklist's privacy_request consumer. Ops:
//
//   access      → run PII_STORES.exportRecords(contact) and RETURN the JSON
//                 bundle for the admin to send the requester (never emailed
//                 from here — no outbound send in E11).
//   delete      → LEGAL HOLD FIRST: if a hold sits on this request's subject
//                 ("privacy", subjectId), record a logged refusal-with-reason
//                 and delete NOTHING (FR-A92 reconciliation). Otherwise run
//                 PII_STORES.deleteOrAnonymize(contact) and resolve the item.
//   hold-set    → place a legal hold on this request's subject.
//   hold-clear  → lift it.
//
// `records` requests are human-fulfilled (retention/legal-hold reconciliation
// off-app), so they get no automated op here — the admin resolves them with a
// note via the normal worklist controls.

import { NextRequest, NextResponse } from "next/server";

import { getSessionUser, requireAdmin } from "@/lib/auth";
import { getWorklistItem, resolveItem } from "@/lib/stores/worklist-store";
import { PII_STORES } from "@/lib/privacy/pii-inventory";
import {
  appendPrivacyAudit,
  clearLegalHold,
  isUnderLegalHold,
  setLegalHold,
} from "@/lib/db/privacy-delete";

export const dynamic = "force-dynamic";

const HOLD_STORE = "privacy";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  let body: { op?: string; itemId?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("invalid request body");
  }
  const op = body.op ?? "";
  const itemId = body.itemId ?? "";
  if (!itemId) return bad("itemId required");

  const item = await getWorklistItem(itemId);
  if (!item || item.type !== "privacy_request") return bad("privacy request not found", 404);

  const payload = item.payload as { requestKind?: string; contact?: string };
  const contact = payload.contact ?? "";
  const held = () => isUnderLegalHold(HOLD_STORE, item.subjectId);

  switch (op) {
    case "access": {
      if (!contact) return bad("this request has no contact on file (already resolved?)");
      const sections = await Promise.all(PII_STORES.map((s) => s.exportRecords(contact)));
      return NextResponse.json({
        ok: true,
        export: { requestedAt: new Date().toISOString(), contact, sections },
      });
    }

    case "delete": {
      if (!contact) return bad("this request has no contact on file (already resolved?)");
      if (await held()) {
        // FR-A92: legal hold overrides deletion — refuse, log, do not delete.
        await appendPrivacyAudit({
          actor,
          action: "privacy-delete-refused-hold",
          store: HOLD_STORE,
          recordId: item.subjectId,
          detail: { reason: "legal hold overrides consumer deletion" },
        });
        return NextResponse.json({
          ok: false,
          refused: "legal-hold",
          message: "A legal hold is in place — deletion refused and logged. Clear the hold to proceed.",
        });
      }
      const results = [];
      for (const s of PII_STORES) {
        results.push(await s.deleteOrAnonymize(contact, actor));
      }
      // Resolving scrubs the contact from the row (redact-at-resolution) and
      // audits — one final proof the request was fulfilled.
      await resolveItem(
        item.id,
        { resolution: "fulfilled", note: "consumer delete fulfilled across the PII inventory", resolvedBy: actor },
        { actor, source: "admin" },
      );
      return NextResponse.json({ ok: true, results });
    }

    case "hold-set": {
      const reason = (body.reason ?? "").trim();
      if (!reason) return bad("a reason is required to place a legal hold");
      await setLegalHold(HOLD_STORE, item.subjectId, reason, actor);
      return NextResponse.json({ ok: true });
    }

    case "hold-clear": {
      const existed = await clearLegalHold(HOLD_STORE, item.subjectId, actor);
      return NextResponse.json({ ok: true, existed });
    }

    default:
      return bad("unknown op");
  }
}
