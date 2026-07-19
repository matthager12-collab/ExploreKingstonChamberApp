import type { Metadata } from "next";
import { getMapViews } from "@/lib/stores/map-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { PageHeader, Section } from "@/components/ui";
import { MapSwitcher } from "./switcher";

export const metadata: Metadata = {
  title: "Map",
  description:
    "Interactive maps of Kingston, WA — food and drink, parking, trails, and more, all walkable from the Edmonds–Kingston ferry.",
};

export const revalidate = 60;

export default async function MapPage() {
  const hiddenPreview = await assertPageVisible("/map");
  const copy = await getCopyOverrides();
  const views = (await getMapViews())
    .filter((v) => v.published)
    .map((v) => ({ id: v.id, name: v.name, description: v.description }));

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "map.header.eyebrow")}
        title={copyText(copy, "map.header.title")}
        intro={copyText(copy, "map.header.intro")}
      />

      <Section>
        <MapSwitcher views={views} />
      </Section>
    </>
  );
}
