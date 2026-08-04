// E20 — the "still coming? / can't make it" endpoint behind the manage-link
// emails (charter step 6). No auth, no account: authority is the
// purpose-scoped HMAC token minted per signup. Idempotent by state machine —
// re-cancel and re-confirm return 200 with truthful already* flags.

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { firstZodMessage } from "@/lib/schemas";
import { volunteerManageActionSchema } from "@/lib/schemas/volunteer";
import { cancelSignup, confirmSignup } from "@/lib/stores/volunteer-signup-store";
import { volunteerSignupEnabled } from "@/lib/volunteer-gate";
import { verifySignupActionToken } from "@/lib/volunteer-links";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!volunteerSignupEnabled()) return bad("Not found", 404);

  const limited = await checkRateLimit(clientKey(request, "volunteer-manage"), {
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) return bad("Too many requests — try again in a minute.", 429);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("Invalid request body");
  }
  const parsed = volunteerManageActionSchema.safeParse(raw);
  if (!parsed.success) return bad(firstZodMessage(parsed.error));
  const { signupId, token, action } = parsed.data;

  // The token's purpose must match the requested action — a leaked cancel
  // link can never confirm, and vice versa.
  if (!verifySignupActionToken(signupId, action, token)) {
    return bad("This link is not valid for that action.", 403);
  }

  if (action === "cancel") {
    const result = await cancelSignup(signupId);
    if (!result.ok) return bad("Signup not found", 404);
    return NextResponse.json({
      ok: true,
      cancelled: true,
      already: result.alreadyCancelled,
    });
  }

  const confirmed = await confirmSignup(signupId);
  // 200 either way (idempotent surface): confirmed:false truthfully reports a
  // signup that is no longer confirmable (cancelled or unknown).
  return NextResponse.json({ ok: true, confirmed });
}
