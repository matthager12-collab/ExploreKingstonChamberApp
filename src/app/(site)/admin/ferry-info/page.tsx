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
import {
  getFerryPredictionEnabled,
  getFerryPredictionSetting,
} from "@/lib/stores/ferry-prediction-store";
import { getAccuracy } from "@/lib/stores/ferry-observations";
import { getBoardingPassStatus } from "@/lib/wsf";
import { PageHeader, Section } from "@/components/ui";
import { FerryInfoEditor } from "./editor";
import { BoardingPassOverrideControl } from "./override-control";
import { FerryPredictionControl } from "./prediction-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ferry settings",
  description:
    "Toggle the ferry busyness prediction, check its accuracy, pin the boarding-pass status, and edit ferry payment and cash facts.",
};

export default async function AdminFerryInfoPage() {
  const [info, override, effective, predEnabled, predSetting, accuracy] = await Promise.all([
    getFerryInfo(),
    getBoardingPassOverride(),
    getEffectiveBoardingPass(),
    getFerryPredictionEnabled(),
    getFerryPredictionSetting(),
    getAccuracy(),
  ]);
  const boardingPass = { estimate: getBoardingPassStatus(), override, effective };
  const prediction = { enabled: predEnabled, setting: predSetting, accuracy };

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Ferry settings"
        intro="Every ferry setting the Chamber controls — the busyness prediction, today's boarding-pass status, and the payment and cash facts. Edits reach public pages within a minute."
      />
      <Section
        title="Busyness prediction"
        subtitle="Turn the ferry busyness estimate on or off for visitors, and watch how accurate it's been. It ships off — validate the accuracy first, then flip it on."
      >
        <FerryPredictionControl initial={prediction} />
      </Section>
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
