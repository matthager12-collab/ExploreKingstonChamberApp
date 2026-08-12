// /claim — folded into the public directory (Mat, 2026-08-12): one browse
// surface instead of two. The claim FORM pages live on at /claim/[id]
// (linked from every /directory profile's claim call-to-action, from the
// eat/stay card forms, and from any direct link the Chamber mails out —
// including for still-unpublished drafts, which no public index lists but
// whose claim pages deliberately keep working).

import { redirect } from "next/navigation";

export default function ClaimIndexRedirect(): never {
  redirect("/directory");
}
