// POST /api/admin/race/checkin { id, checkedIn } — the admin roster's
// check-in control. Set-state, not toggle (see setCheckedIn): a repeated
// request is a no-op, so a double click or a retried fetch cannot un-check
// a runner. The volunteer route (api/checkin/set) is the cookie-gated twin.
//
// 401 signed out · 403 not admin · 404 unknown runner · 409 cancelled runner.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser, requireAdmin } from "@/lib/auth";
import { setCheckedIn } from "@/lib/db/race-registrants";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ id: z.string().uuid(), checkedIn: z.boolean() }).strict();

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = (await getSessionUser())!;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await setCheckedIn(body.id, body.checkedIn, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "not-found" ? "No such runner." : "That registration was cancelled." },
      { status: result.reason === "not-found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ changed: result.changed });
}
