// E20 — the manage surface behind every confirmation/reminder email
// (charter step 8): "I'm still coming" / "I can't make it", no account.
//
// Access = the cancel-purpose HMAC token in ?t (the link IS the credential).
// Everything failing — flag off, bad token, unknown signup, anonymized row —
// is the same clean notFound(): no oracle distinguishes "never existed"
// from "expired", and the site's 404 page is the friendly dead-link message.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getVolunteerNeedsAdmin } from "@/lib/stores/charity-store";
import { getSignup } from "@/lib/stores/volunteer-signup-store";
import { formatPacificDate } from "@/lib/time";
import { volunteerSignupEnabled } from "@/lib/volunteer-gate";
import { signupActionToken, verifySignupActionToken } from "@/lib/volunteer-links";
import { PageHeader } from "@/components/ui";
import { ManageActions } from "./manage-actions";

export const metadata: Metadata = { title: "Your volunteer shift", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ManageSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ signupId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  if (!volunteerSignupEnabled()) notFound();
  const { signupId } = await params;
  const { t } = await searchParams;
  if (!t || !verifySignupActionToken(signupId, "cancel", t)) notFound();

  const signup = await getSignup(signupId);
  if (!signup || signup.anonymizedAt) notFound();

  // Admin read on purpose: the shift may have been hidden or tombstoned since
  // the signup — the volunteer still deserves their manage page. A tombstoned
  // shift keeps only its id, so the copy degrades to a generic line.
  const shift = (await getVolunteerNeedsAdmin()).find((n) => n.id === signup.shiftId);

  const cancelled = signup.state === "cancelled";

  return (
    <>
      <PageHeader
        eyebrow="Volunteer shift"
        title={shift?.title ?? "Your volunteer shift"}
        intro={
          shift
            ? `${formatPacificDate(shift.date)} · ${shift.timeRange}`
            : "The details for this shift are no longer listed."
        }
      />
      <div className="mx-auto max-w-2xl px-4 pb-16">
        {cancelled ? (
          <p role="status" className="text-sm font-medium text-ink">
            This signup is cancelled. Changed your mind? Sign up again from the{" "}
            <a href="/give" className="text-tide-deep underline underline-offset-2">
              volunteer page
            </a>
            .
          </p>
        ) : (
          <ManageActions
            signupId={signupId}
            confirmToken={signupActionToken(signupId, "confirm")}
            cancelToken={signupActionToken(signupId, "cancel")}
          />
        )}
      </div>
    </>
  );
}
