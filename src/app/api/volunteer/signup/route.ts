// E20 — the no-account volunteer signup intake (charter step 6). POST, no
// auth EVER (M-06-01/FR-VOL-01; the no-auth tests are CI-blocking).
//
// The idempotency key arrives ONLY in the X-Idempotency-Key header (E13
// convention) and is REQUIRED — unlike /api/survey there are no legacy
// clients to indulge. Dedupe diverges from the shared idempotency_keys
// claim table on purpose: the key is UNIQUE on the volunteer_signup row so a
// replay returns the ORIGINAL signupId/spotsLeft (documented in
// docs/SDD.md, slice 4). Do NOT also claim in the shared table — a key
// claimed there whose INSERT then failed would wedge replays forever.
//
// Everything ships dark: with VOLUNTEER_SIGNUP_ENABLED unset this route is a
// plain 404, indistinguishable from not existing.

import { NextRequest, NextResponse } from "next/server";

import { IDEMPOTENCY_KEY_RE } from "@/lib/db/idempotency";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import {
  deriveContactKind,
  volunteerSignupInputSchema,
} from "@/lib/schemas/volunteer";
import { createSignup } from "@/lib/stores/volunteer-signup-store";
import { getCharity, getVolunteerNeeds } from "@/lib/stores/charity-store";
import { firstZodMessage } from "@/lib/schemas";
import { formatPacificDate, todayPacific } from "@/lib/time";
import { shiftPacificDay, volunteerSignupEnabled } from "@/lib/volunteer-gate";
import { manageUrl } from "@/lib/volunteer-links";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!volunteerSignupEnabled()) return bad("Not found", 404);

  const limited = await checkRateLimit(clientKey(request, "volunteer-signup"), {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return bad("Too many signups from this connection — try again in a minute.", 429);
  }

  // The E13 header convention, REQUIRED here (charter step 6).
  const key = request.headers.get("X-Idempotency-Key");
  if (!key || !IDEMPOTENCY_KEY_RE.test(key)) {
    return bad("X-Idempotency-Key header required (8–64 chars of [A-Za-z0-9-]).");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return bad("Request body too large.", 413);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad("Invalid request body");
  }

  const parsed = volunteerSignupInputSchema.safeParse(raw);
  if (!parsed.success) return bad(firstZodMessage(parsed.error));
  const { shiftId, name, contact } = parsed.data;

  const contactKind = deriveContactKind(contact);
  if (!contactKind) {
    return bad("Contact must be an email address or a phone number.");
  }

  // Live-only read (E08): pending/draft/hidden shifts are a plain 404 — a
  // signup must never confirm the existence of unmoderated content.
  const shift = (await getVolunteerNeeds()).find((n) => n.id === shiftId);
  if (!shift) return bad("Shift not found", 404);
  const day = shiftPacificDay(shift.date);
  if (!day || day < todayPacific()) return bad("This shift has already happened.", 410);

  const result = await createSignup({ shiftId, name, contact, contactKind, idempotencyKey: key });
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: "full", spotsLeft: 0 }, { status: 409 });
  }

  // Best-effort confirmation for email contacts — a failed send never fails
  // the signup, and phone contacts get no automated email by design (the UI
  // copy says so; SMS is E21's).
  if (contactKind === "email" && !result.replayed) {
    const charity = await getCharity(shift.charityId);
    await sendEmail({
      to: contact,
      subject: `You're signed up: ${shift.title} (${formatPacificDate(shift.date)})`,
      text:
        `You're on the list for "${shift.title}"` +
        (charity ? ` with ${charity.name}` : "") +
        ` on ${formatPacificDate(shift.date)}, ${shift.timeRange}.\n\n` +
        `Plans change? Confirm or cancel here:\n${manageUrl(result.signupId)}\n\n` +
        `We'll email a reminder before the shift. Thanks for raising your hand — Kingston runs on volunteers.`,
    });
  }

  return NextResponse.json({ ok: true, signupId: result.signupId, spotsLeft: result.spotsLeft });
}
