// Member event page API (docs/adr/ADR-0009). A business saves ONE url of its
// own events page; a daily cron (and "Check now") turns it into DRAFT events.
//
// GET  ?ownerId=X — the saved page + this owner's 'new' drafts.
// PUT  { ownerId, url } — save the page url; "" clears it (drafts are kept).
// POST { ownerId, action: "check" } — run a check now (rate limited).
// POST { ownerId, action: "dismiss" | "published", draftId } — retire a draft.
//
// Every verb needs a session and can(user, "edit-record", ownerId). Drafts are
// never public: publishing goes through POST /api/portal/events from the
// browser, so the moderation floor there applies unchanged.

import { NextRequest, NextResponse } from "next/server";
import { can, getSessionUser } from "@/lib/auth";
import { checkMemberEventPage } from "@/lib/events/member-page-check";
import { parseMemberPageUrl } from "@/lib/events/member-page-fetch";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  claimCheck,
  clearEventPage,
  getEventPage,
  listNewDrafts,
  saveEventPage,
  setDraftStatus,
} from "@/lib/stores/member-event-page-store";

export const dynamic = "force-dynamic";

/** One check per listing per 10 minutes. */
const CHECK_INTERVAL_MS = 10 * 60_000;

async function payload(ownerId: string) {
  const [page, drafts] = await Promise.all([getEventPage(ownerId), listNewDrafts(ownerId)]);
  return {
    page: page
      ? {
          url: page.url,
          lastCheckedAt: page.lastCheckedAt?.toISOString() ?? null,
          lastError: page.lastError,
        }
      : null,
    drafts: drafts.map((d) => ({
      id: d.id,
      title: d.title,
      start: d.start,
      end: d.end,
      venue: d.venue,
      description: d.description,
      category: d.category,
      rrule: d.rrule,
      ticketUrl: d.ticketUrl,
      timeMissing: d.timeMissing,
    })),
  };
}

// Each handler calls getSessionUser() itself (the authz coverage test requires a
// gate in every handler); this applies the rest of the check.
function gate(user: Awaited<ReturnType<typeof getSessionUser>>, ownerId: string) {
  if (!user) return { error: NextResponse.json({ error: "Sign in first" }, { status: 401 }) };
  if (!ownerId) {
    return { error: NextResponse.json({ error: "ownerId required" }, { status: 400 }) };
  }
  if (!can(user, "edit-record", ownerId)) {
    return {
      error: NextResponse.json({ error: "You don't manage that listing" }, { status: 403 }),
    };
  }
  return { user };
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = (await request.json()) as unknown;
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const ownerId = request.nextUrl.searchParams.get("ownerId") ?? "";
  const g = gate(await getSessionUser(), ownerId);
  if (g.error) return g.error;
  return NextResponse.json(await payload(ownerId));
}

export async function PUT(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  const g = gate(await getSessionUser(), ownerId);
  if (g.error) return g.error;

  const raw = typeof body.url === "string" ? body.url.trim() : null;
  if (raw === null) return NextResponse.json({ error: "url required" }, { status: 400 });

  if (raw === "") {
    await clearEventPage(ownerId);
  } else {
    const u = parseMemberPageUrl(raw);
    if (!u) {
      return NextResponse.json(
        { error: "That link isn't allowed. Use a full link that starts with https://" },
        { status: 400 },
      );
    }
    await saveEventPage(ownerId, u.toString());
  }
  return NextResponse.json({ ok: true, ...(await payload(ownerId)) });
}

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  const g = gate(await getSessionUser(), ownerId);
  if (g.error) return g.error;
  const { user } = g;
  const action = body.action;

  if (action === "check") {
    // Per-user cap first: it also covers a user cycling through listings.
    const rl = await checkRateLimit(`event-page-check:${user.id}`, {
      limit: 10,
      windowMs: 60 * 60_000,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many checks. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }
    if (!(await getEventPage(ownerId))) {
      return NextResponse.json({ error: "Save your events page link first" }, { status: 400 });
    }
    // Atomic per-listing claim: only one press per 10 minutes wins.
    if (!(await claimCheck(ownerId, new Date(Date.now() - CHECK_INTERVAL_MS)))) {
      return NextResponse.json(
        { error: "That page was just checked. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": "600" } },
      );
    }
    const result = await checkMemberEventPage(ownerId);
    return NextResponse.json({
      ok: result.ok,
      ...(result.ok ? { found: result.found, added: result.added } : { error: result.error }),
      ...(await payload(ownerId)),
    });
  }

  if (action === "dismiss" || action === "published") {
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    const status = action === "dismiss" ? "dismissed" : "published";
    // Scoped to ownerId AND status 'new' in one statement: another listing's
    // draft, or one already retired, is simply "not found".
    if (!draftId || !(await setDraftStatus(ownerId, draftId, status))) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
