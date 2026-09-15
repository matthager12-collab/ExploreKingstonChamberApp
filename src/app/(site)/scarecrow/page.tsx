// The Scarecrow Crawl (2026) — pins, a vote, and a share link.
//
// The map is built from the seed list right here rather than from a stored
// MapView: the crawl is four weeks of content, not a permanent layer, so it
// gets a resolved view object instead of a row in the map store and an entry
// in the /map switcher. FeatureMap renders a pre-resolved payload directly.
//
// ACCESSIBILITY: the map is an enhancement, not the page. "Every scarecrow, in
// words" below it carries the same facts in text — the same rule /parking
// follows (docs/ACCESSIBILITY.md, "text alternative"), and the thing that
// actually works on a phone in a Kitsap October.

import type { Metadata } from "next";
import { FeatureMap } from "@/components/feature-map";
import { ScarecrowVote } from "@/components/scarecrow-vote";
import { PageHeader, Section } from "@/components/ui";
import {
  CRAWL_MAP_CENTER,
  CRAWL_MAP_ZOOM,
  SCARECROWS,
  crawlPhase,
} from "@/lib/data/scarecrows";
import type { ResolvedMapView } from "@/lib/map/types";
import { assertPageVisibleStatic } from "@/lib/page-visibility";
import { getVoteCounts } from "@/lib/stores/scarecrow-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

export const metadata: Metadata = {
  title: "Scarecrow Crawl",
  description:
    "Find every scarecrow in Kingston, vote for your favourite, and share it — Saturday 17 October to 5pm Saturday 31 October 2026.",
};

export const revalidate = 60;

/** The crawl's map, assembled from the seed list. One marker per scarecrow. */
function resolvedView(): ResolvedMapView {
  return {
    view: {
      id: "scarecrow-crawl",
      name: "Scarecrow Crawl",
      center: CRAWL_MAP_CENTER,
      zoom: CRAWL_MAP_ZOOM,
      sources: [],
      published: true,
    },
    features: SCARECROWS.map((s) => ({
      id: s.id,
      kind: "marker" as const,
      title: s.title,
      category: "event",
      notes: `${s.business} · ${s.address}${s.blurb ? ` — ${s.blurb}` : ""}`,
      views: ["scarecrow-crawl"],
      point: [s.lat, s.lng] as [number, number],
      label: { text: s.title },
    })),
    builtins: {},
  };
}

export default async function ScarecrowPage() {
  await assertPageVisibleStatic("/scarecrow");
  const copy = await getCopyOverrides();
  const phase = crawlPhase();
  // Results stay shut until the crawl does. Before then the page never reads a
  // count, so there is no number to leak, cache, or argue with mid-contest.
  const counts = phase === "closed" ? await getVoteCounts() : {};

  const ranked =
    phase === "closed"
      ? [...SCARECROWS]
          .map((s) => ({ scarecrow: s, votes: counts[s.id] ?? 0 }))
          .sort((a, b) => b.votes - a.votes || a.scarecrow.business.localeCompare(b.scarecrow.business))
      : [];

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "scarecrow.header.eyebrow")}
        title={copyText(copy, "scarecrow.header.title")}
        intro={copyText(copy, "scarecrow.header.intro")}
      />

      <Section>
        <ScarecrowVote
          scarecrows={SCARECROWS.map((s) => ({
            id: s.id,
            business: s.business,
            title: s.title,
          }))}
          phase={phase}
        />
      </Section>

      <Section title="Where the scarecrows are">
        <p className="mb-4 text-ink">
          Tap a pin for the business hosting it. Everything on this map is within a walk of
          downtown Kingston.
        </p>
        <FeatureMap resolved={resolvedView()} height="460px" />
      </Section>

      <Section title="Every scarecrow, in words">
        <ul className="space-y-4">
          {SCARECROWS.map((s) => (
            <li key={s.id}>
              <h3 className="font-semibold text-ink">{s.title}</h3>
              <p className="text-ink">
                {s.business} — {s.address}
              </p>
              {s.blurb ? <p className="text-ink-soft">{s.blurb}</p> : null}
            </li>
          ))}
        </ul>
      </Section>

      {phase === "closed" ? (
        <Section title="Results">
          <p className="mb-4 text-ink-soft">
            Votes are counted once per device, not per person — a good measure of which scarecrow
            people liked, not an audited ballot.
          </p>
          <ol className="space-y-2">
            {ranked.map(({ scarecrow, votes }) => (
              <li key={scarecrow.id} className="text-ink">
                <span className="font-semibold">{scarecrow.title}</span> — {scarecrow.business} ·{" "}
                {votes} {votes === 1 ? "vote" : "votes"}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}
