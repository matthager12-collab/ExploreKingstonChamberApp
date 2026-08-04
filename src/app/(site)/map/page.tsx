import type { Metadata } from "next";
import Link from "next/link";
import { getMapViews } from "@/lib/stores/map-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisibleStatic } from "@/lib/page-visibility";
import { PageHeader, Section } from "@/components/ui";
import { MapSwitcher } from "./switcher";

export const metadata: Metadata = {
  title: "Map",
  description:
    "Interactive maps of Kingston, WA — food and drink, parking, trails, and more, all walkable from the Edmonds–Kingston ferry.",
};

export const revalidate = 60;

export default async function MapPage() {
  // ISR page: the cookie-free gate is the one that actually bakes the 404
  // when hidden (see assertPageVisibleStatic + the /give find, 2026-08-03).
  await assertPageVisibleStatic("/map");
  const copy = await getCopyOverrides();
  const views = (await getMapViews())
    .filter((v) => v.published)
    .map((v) => ({ id: v.id, name: v.name, description: v.description }));

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "map.header.eyebrow")}
        title={copyText(copy, "map.header.title")}
        intro={copyText(copy, "map.header.intro")}
      />

      <Section>
        <MapSwitcher views={views} />
      </Section>

      {/* E27: the restroom question is urgent and time-boxed in a way "browse a
          map layer" is not — it gets a direct route, not just a layer in the
          switcher above. */}
      <Section>
        <Link
          href="/map/restrooms"
          className="inline-flex min-h-[44px] items-center rounded-full border border-tide px-5 py-2.5 text-sm font-semibold text-tide-deep hover:bg-tide/5"
        >
          {copyText(copy, "map.restrooms.link")}
        </Link>
      </Section>
    </>
  );
}
