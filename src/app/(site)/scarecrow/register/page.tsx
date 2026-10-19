import type { Metadata } from "next";
import Link from "next/link";
import { ScarecrowRegister } from "@/components/scarecrow-register";
import { PageHeader, Section } from "@/components/ui";
import { lateRegistrationOpen } from "@/lib/data/scarecrows";
import { HiddenPageBanner, assertPageVisible } from "@/lib/page-visibility";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Late Scarecrow Crawl registration",
  description: "Submit a late entry for Chamber approval during Kingston's 2026 Scarecrow Crawl.",
};

export default async function LateScarecrowRegistrationPage() {
  const hiddenPreview = await assertPageVisible("/scarecrow");
  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader eyebrow="Scarecrow Crawl 2026" title="Late scarecrow registration" />
      <Section>
        {lateRegistrationOpen() ? (
          <>
            <p className="mb-4 text-ink">
              Still joining the crawl? Submit your scarecrow by 5pm Pacific on Saturday 31 October 2026.
              The Chamber checks every entry before it goes on the trail, and it appears on the crawl
              page once approved. Submitting does not guarantee approval before voting closes.
            </p>
            <ScarecrowRegister late />
          </>
        ) : (
          <p className="mb-4 text-ink">
            Late registration is closed. This form is available only during the 17–31 October 2026
            crawl, until 5pm Pacific on 31 October.
          </p>
        )}
        <p className="mt-6"><Link href="/scarecrow" className="underline">Back to the Scarecrow Crawl</Link></p>
      </Section>
    </>
  );
}
