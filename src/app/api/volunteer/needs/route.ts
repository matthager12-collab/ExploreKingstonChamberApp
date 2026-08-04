// E20 — the public spots-left feed (charter step 6): live upcoming shifts
// only, structurally PII-free (the response shape simply has no person
// fields; the needs-route test greps the JSON to keep it that way). The
// /give page stays ISR — this feed is how the signup component refreshes
// counts after an action without disabling that.

import { NextResponse } from "next/server";

import { getCharities, getVolunteerNeeds } from "@/lib/stores/charity-store";
import { todayPacific } from "@/lib/time";
import { shiftPacificDay, volunteerSignupEnabled } from "@/lib/volunteer-gate";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!volunteerSignupEnabled()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const [needs, charities] = await Promise.all([getVolunteerNeeds(), getCharities()]);
  const charityName = new Map(charities.map((c) => [c.id, c.name]));
  const today = todayPacific();

  const shifts = needs
    .filter((n) => {
      const day = shiftPacificDay(n.date);
      return day !== null && day >= today;
    })
    .map((n) => ({
      id: n.id,
      title: n.title,
      charityId: n.charityId,
      charityName: charityName.get(n.charityId) ?? null,
      date: n.date,
      timeRange: n.timeRange,
      ...(n.startTime ? { startTime: n.startTime } : {}),
      slotsTotal: n.slotsTotal,
      slotsFilled: n.slotsFilled,
      spotsLeft: Math.max(n.slotsTotal - n.slotsFilled, 0),
    }));

  return NextResponse.json(
    { ok: true, shifts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
