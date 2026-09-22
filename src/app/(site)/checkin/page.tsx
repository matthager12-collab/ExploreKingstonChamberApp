// /checkin — the race-day packet-pickup screen volunteers open from the
// link an admin minted (api/checkin/redeem sets the cookie). Top-level on
// purpose: it must not follow /race's show/hide toggle. Cookie-gated here and
// again on every write (api/checkin/set). Renders no email, ever.

import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader, Callout, Section } from "@/components/ui";
import { race } from "@/lib/data/race";
import { listCheckinRoster } from "@/lib/db/race-registrants";
import { readCheckinAccess } from "@/lib/race/checkin-access";
import { CHECKIN_COOKIE } from "@/lib/race/checkin-token";

import { CheckinClient } from "./client";

export const metadata: Metadata = {
  title: "Race-day check-in",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const store = await cookies();
  const claims = await readCheckinAccess(store.get(CHECKIN_COOKIE)?.value);

  if (!claims) {
    return (
      <>
        <PageHeader eyebrow="Race day" title="Runner check-in" />
        <Section>
          <Callout title={error === "link" ? "That link doesn't work" : "You need the race-day link"} tone="coral">
            Ask the Chamber for the current race-day link — it was minted from the admin console and may
            have been replaced or expired.
          </Callout>
        </Section>
      </>
    );
  }

  const rows = (await listCheckinRoster()).map((r) => ({
    ...r,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader eyebrow="Race day" title={race.shortName} intro="Find the runner, tap Check in, hand over the packet." />
      <CheckinClient rows={rows} hasWaiverQuestion={race.questions.waiver !== null} />
    </>
  );
}
