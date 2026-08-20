// E08 report-inaccurate intake (M-19-04 / FR-26): the public "something is
// wrong here" loop. POST { store, id, message, contact? } — no account, no
// location, no required identity (M-15-06); the payload schema enforces that
// shape and a schema test breaks the build if it ever grows a lat/lng.
//
// A second report on the same record merges into the open worklist item
// (messages appended, count bumped) — the Chamber sees ONE queue entry per
// disputed record, however many visitors pile on.
//
// Rate limiting copies the login route's dual-bucket pattern: an IP bucket
// BEFORE the body parse, then a per-record bucket so one hot listing can't
// eat a shared IP's whole budget (and one spammer can't bury one record).

import { NextRequest, NextResponse } from "next/server";
import { MODERATED_STORES, getSubjectRecord } from "@/lib/moderation";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { createWorklistItem } from "@/lib/stores/worklist-store";
import { WorklistValidationError } from "@/lib/schemas/worklist";

export const dynamic = "force-dynamic";

const MAX_MESSAGE = 2_000;
const MAX_CONTACT = 200;

// Cap the raw body before parsing (same pattern as the feedback intake):
// MAX_MESSAGE bounds what we KEEP, but only after JSON.parse has already
// materialized whatever was sent. 8 KB comfortably fits every legal payload.
const MAX_BODY_BYTES = 8_192;

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many reports, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const ipLimit = await checkRateLimit(clientKey(request, "report"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const store = typeof body.store === "string" ? body.store : "";
  const id = typeof body.id === "string" ? body.id : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";

  if (!MODERATED_STORES.includes(store)) {
    return NextResponse.json({ error: "unknown store" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!message) {
    return NextResponse.json({ error: "say what looks wrong" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `message must be ${MAX_MESSAGE} characters or fewer` },
      { status: 400 },
    );
  }
  if (contact.length > MAX_CONTACT) {
    return NextResponse.json(
      { error: `contact must be ${MAX_CONTACT} characters or fewer` },
      { status: 400 },
    );
  }

  // Per-record bucket AFTER the parse (login-route pattern).
  const recordLimit = await checkRateLimit(`report:${store}:${id}`, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!recordLimit.ok) return tooMany(recordLimit.retryAfterSeconds);

  // Any-status lookup: a just-taken-down record may still be on cached pages,
  // and a report about it is still useful to the Chamber.
  const subject = await getSubjectRecord(store, id);
  if (!subject) {
    return NextResponse.json({ error: "record not found" }, { status: 404 });
  }
  const label =
    String(
      (subject as Record<string, unknown>).name ??
        (subject as Record<string, unknown>).title ??
        subject.id,
    ) || subject.id;

  try {
    await createWorklistItem(
      {
        type: "report_inaccurate",
        subjectStore: store,
        subjectId: id,
        subjectLabel: label,
        payload: {
          messages: [
            {
              message,
              ...(contact ? { contact } : {}),
              at: new Date().toISOString(),
            },
          ],
          count: 1,
        },
      },
      { actor: "public", source: "public" },
    );
  } catch (err) {
    if (err instanceof WorklistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
