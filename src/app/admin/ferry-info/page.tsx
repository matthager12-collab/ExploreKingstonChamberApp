// Chamber-facing ferry-facts editor: the structured payment / boarding-pass /
// cash / sources records behind /ferry and /parking, editable field-by-field.
// Page access is admin-gated by the /admin layout; the API it saves through
// (/api/admin/ferry-info) re-checks the admin role server-side.

import type { Metadata } from "next";
import { getFerryInfo } from "@/lib/stores/ferry-info-store";
import {
  getBoardingPassOverride,
  getEffectiveBoardingPass,
} from "@/lib/stores/boarding-pass-store";
import { getBoardingPassStatus } from "@/lib/wsf";
import { PageHeader, Section } from "@/components/ui";
import { FerryInfoEditor } from "./editor";
import { BoardingPassOverrideControl } from "./override-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ferry & cash facts",
  description:
    "Edit the ferry payment methods, boarding-pass hours, cash tips, and the machine-down note behind /ferry and /parking.",
};

export default async function AdminFerryInfoPage() {
  const [info, override, effective] = await Promise.all([
    getFerryInfo(),
    getBoardingPassOverride(),
    getEffectiveBoardingPass(),
  ]);
  const boardingPass = { estimate: getBoardingPassStatus(), override, effective };

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Ferry & cash facts"
        intro="The structured facts behind the ferry and parking pages: how to pay, when the boarding-pass system runs, cash tips, and the machine-down note that changes most often. Edit a field and save its group — public pages update within a minute."
      />
      <Section
        title="Facts"
        subtitle="Each group saves on its own. The machine-down note is up top because it changes most often. Untouched fields always follow the site's built-in wording."
      >
        <BoardingPassOverrideControl initial={boardingPass} />
        <FerryInfoEditor initial={info} />
      </Section>
    </>
  );
}
