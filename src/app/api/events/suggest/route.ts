// E12 public event-suggestion intake (M-05-03 / FR-EVT-04): the no-account
// "add your event to the Kingston calendar" form. ALWAYS lands
// status='pending' in the E08 moderation queue — the anonymous path has no
// bypass of any kind (trustedAutoPublish is an org flag; there is no org
// here).
//
// multipart/form-data (the form can attach artwork/flyers). Fields:
//   title, start, end?, venue, description?, url?           — the event doc
//   eventContact     — PUBLIC contact shown on the event (REQUIRED)
//   submitterName, contact — the submitter, PRIVATE (moderation follow-up only)
//   attachments      — 0..MAX_ATTACHMENTS files (images + PDF)
//   website2         — honeypot
//
// Two different contacts, deliberately: `eventContact` is public (so the town
// asks the organizer, not the Chamber); `contact` is the submitter's and never
// leaves the worklist payload (MHMDA data minimization — no other submitter
// data, no location capture).
//
// Abuse controls: IP rate limit (5/hour) BEFORE the body parse, honeypot,
// per-file type + size caps, a per-run count cap, and a shared-disk storage
// ceiling in filesystem mode.

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { holdSuggestedRecord } from "@/lib/moderation";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { hasBlob } from "@/lib/blob-store";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { eventSchema, firstZodMessage, MAX_ATTACHMENTS } from "@/lib/schemas";
import {
  attachmentExtension,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/events/attachment-refs";
import {
  attachmentStorageBytes,
  deleteAttachment,
  MAX_ATTACHMENT_STORAGE_BYTES,
  saveAttachment,
} from "@/lib/events/attachment-store";
import { UnstrippableImageError } from "@/lib/image-sanitize";
import { getUnifiedCalendarAccess } from "@/lib/stores/unified-calendar-store";
import { WorklistValidationError } from "@/lib/schemas/worklist";
import type { EventItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_NAME = 200;
const MAX_CONTACT = 200;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event"
  );
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  // Ship-dark: the suggest surface exists only where the unified calendar
  // does (flag ON, or a signed-in admin previewing). 404, not 403 — the
  // surface is dark, not forbidden.
  const access = await getUnifiedCalendarAccess();
  if (!access.enabled && !access.adminPreview) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ipLimit = await checkRateLimit(clientKey(request, "events-suggest"), {
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "too many suggestions, please try again later" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  // Honeypot: a hidden field humans never see. A filled one gets a bland 200
  // so the bot learns nothing; nothing is stored.
  if (field(form, "website2") !== "") {
    return NextResponse.json({ ok: true, pending: true });
  }

  const submitterName = field(form, "submitterName");
  const contact = field(form, "contact");
  const eventContact = field(form, "eventContact");
  if (!submitterName || submitterName.length > MAX_NAME) {
    return NextResponse.json({ error: "your name is required" }, { status: 400 });
  }
  if (!contact || contact.length > MAX_CONTACT) {
    return NextResponse.json(
      { error: "a way for the Chamber to reach you is required (email or phone)" },
      { status: 400 },
    );
  }
  if (!eventContact || eventContact.length > MAX_CONTACT) {
    return NextResponse.json(
      { error: "a public contact for the event is required (who attendees should ask)" },
      { status: 400 },
    );
  }

  // Event fields validate through the ONE events schema (E07 rule: never a
  // parallel validator). The intake supplies what the public form doesn't ask:
  // a fresh id, the default category, and organizer = submitter name.
  const candidate = {
    id: `${slugify(field(form, "title"))}-${randomBytes(3).toString("hex")}`,
    title: form.get("title"),
    start: form.get("start"),
    end: form.get("end"),
    venue: form.get("venue"),
    description: form.get("description"),
    category: "community",
    organizer: submitterName,
    url: form.get("url"),
    eventContact,
  };
  const parsed = eventSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodMessage(parsed.error) }, { status: 400 });
  }
  const event = parsed.data as EventItem;

  // Attachments (optional). Validate everything BEFORE persisting the record,
  // and if any file fails, clean up the ones already stored so a rejected
  // submission never leaves orphaned bytes behind.
  const files = form
    .getAll("attachments")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `at most ${MAX_ATTACHMENTS} files` },
      { status: 400 },
    );
  }
  if (files.length > 0 && !hasBlob() && (await attachmentStorageBytes()) > MAX_ATTACHMENT_STORAGE_BYTES) {
    return NextResponse.json(
      { error: "attachment storage is full — the Chamber needs to clear space" },
      { status: 507 },
    );
  }

  const refs: string[] = [];
  for (const file of files) {
    const fail = async (status: number, error: string) => {
      await Promise.all(refs.map((r) => deleteAttachment(r)));
      return NextResponse.json({ error }, { status });
    };
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return fail(413, `"${file.name}" is too large (max 8 MB per file)`);
    }
    const ext = attachmentExtension(file.type, file.name);
    if (!ext) {
      return fail(415, `"${file.name}" is not a supported file (images or PDF only)`);
    }
    try {
      refs.push(await saveAttachment(event.id, new Uint8Array(await file.arrayBuffer()), ext));
    } catch (err) {
      // A file we cannot strip metadata from is the SUBMITTER's problem, not
      // ours — say so with a 4xx instead of a 500, which would read as an
      // outage and send them into a retry loop that can never succeed.
      // Stripping is fail-closed on purpose (M-16-02): we would rather reject
      // an unreadable image than store bytes we could not verify.
      if (err instanceof UnstrippableImageError) {
        return fail(400, `"${file.name}" could not be processed — please re-save or export it and try again`);
      }
      return fail(500, "could not save an attachment — please try again");
    }
  }
  if (refs.length > 0) event.attachments = refs;

  try {
    await holdSuggestedRecord("events", event, event.title, { submitterName, contact });
  } catch (err) {
    await Promise.all(refs.map((r) => deleteAttachment(r)));
    if (err instanceof RecordValidationError || err instanceof WorklistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, pending: true });
}
