// Admin API for the unified events calendar (E12) — backs
// /admin/events-sources.
//
// GET  — admin: full snapshot (flag, per-source config + last-run reports,
//        dedupe-review clusters, stored overrides, orgs w/ trust flag).
// POST — admin actions:
//        { action: "set-flag", enabled }            flip the ship-dark flag
//        { action: "set-source", id, enabled }      enable/disable a source
//        { action: "sync-now" }                     run ingest server-side
//        { action: "not-duplicate", keyA, keyB }    record a dedupe verdict
//        { action: "remove-override", id }          undo a verdict
//        { action: "set-trusted-org", orgId, trusted }  FR-EVT-04 bypass flag
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// UI; this handler re-checks because API routes bypass layouts. "Sync now"
// calls runIngest() directly — the public token stays for the cron only.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, listOrganizations, requireAdmin, setOrgTrustedAutoPublish } from "@/lib/auth";
import { runIngest } from "@/lib/events/ingest";
import { getUnifiedReview } from "@/lib/events/unified";
import { RecordValidationError } from "@/lib/db/store-schemas";
import {
  getCalendarSources,
  setSourceEnabled,
  type IngestSourceId,
} from "@/lib/stores/calendar-sources-store";
import {
  addEventOverride,
  listEventOverrides,
  removeEventOverride,
} from "@/lib/stores/event-overrides-store";
import {
  getUnifiedCalendarEnabled,
  getUnifiedCalendarSetting,
  setUnifiedCalendarEnabled,
} from "@/lib/stores/unified-calendar-store";

export const dynamic = "force-dynamic";

const SOURCE_IDS: readonly IngestSourceId[] = [
  "ams-ical",
  "tribe-explorekingstonwa",
  "tribe-portofkingston",
];

async function snapshot() {
  const [enabled, setting, sources, overrides, review, orgs] = await Promise.all([
    getUnifiedCalendarEnabled(),
    getUnifiedCalendarSetting(),
    getCalendarSources(),
    listEventOverrides(),
    getUnifiedReview(),
    listOrganizations(),
  ]);
  return {
    flag: { enabled, setting },
    sources,
    overrides,
    mergedCount: review.merged.length,
    clusters: review.clusters.map((c) => ({
      survivor: c.survivor,
      members: c.members,
    })),
    orgs: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      trustedAutoPublish: o.trustedAutoPublish,
    })),
  };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json(await snapshot());
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const setBy = user.name || user.email || "admin";
  const meta = { actor: user.email, source: "admin" as const };

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "set-flag": {
        if (typeof body.enabled !== "boolean") {
          return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
        }
        await setUnifiedCalendarEnabled(body.enabled, setBy, meta);
        break;
      }
      case "set-source": {
        const id = body.id as IngestSourceId;
        if (!SOURCE_IDS.includes(id) || typeof body.enabled !== "boolean") {
          return NextResponse.json({ error: "unknown source or bad enabled" }, { status: 400 });
        }
        await setSourceEnabled(id, body.enabled, setBy, meta);
        break;
      }
      case "sync-now": {
        const perSource = await runIngest(user.email);
        return NextResponse.json({ ok: true, perSource, ...(await snapshot()) });
      }
      case "not-duplicate": {
        const keyA = typeof body.keyA === "string" ? body.keyA : "";
        const keyB = typeof body.keyB === "string" ? body.keyB : "";
        if (!keyA || !keyB || keyA === keyB) {
          return NextResponse.json({ error: "two distinct keys required" }, { status: 400 });
        }
        await addEventOverride(keyA, keyB, setBy, meta);
        break;
      }
      case "remove-override": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await removeEventOverride(id, meta);
        break;
      }
      case "set-trusted-org": {
        const orgId = typeof body.orgId === "string" ? body.orgId : "";
        if (!orgId || typeof body.trusted !== "boolean") {
          return NextResponse.json({ error: "orgId and trusted required" }, { status: 400 });
        }
        await setOrgTrustedAutoPublish(orgId, body.trusted, user.email);
        break;
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, ...(await snapshot()) });
}
