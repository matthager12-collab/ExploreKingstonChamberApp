// The Scarecrow Crawl (2026) — registration, pins, a vote, and a share link.
//
// Two lives. Until the crawl opens on 17 October the page leads with
// "register your scarecrow" for businesses and makers, and approved entries
// appear underneath as the Chamber accepts them. From the 17th the form is
// gone and the page is the trail: map, list, vote.
//
// The entries come from the "scarecrow-crawl" map view, which the Chamber
// edits itself (in /admin/maps, or from the crawl console). This page renders
// exactly what is on that view: same markers on the map, same names in the
// list, same ids on the ballot.
//
// ACCESSIBILITY: the map is an enhancement, not the page. "Every scarecrow, in
// words" below it carries the same facts in text — the same rule /parking
// follows (docs/ACCESSIBILITY.md, "text alternative"), and the thing that
// actually works on a phone in a Kitsap October.

import type { Metadata } from "next";
import { FeatureMap } from "@/components/feature-map";
import { ScarecrowRegister } from "@/components/scarecrow-register";
import { ScarecrowVote } from "@/components/scarecrow-vote";
import { PageHeader, Section } from "@/components/ui";
import { CRAWL_VIEW_ID, isUnplaced, registrationOpen } from "@/lib/data/scarecrows";
import { resolveMapView } from "@/lib/map/resolve";
import { HiddenPageBanner, assertPageVisible } from "@/lib/page-visibility";
import { getCrawlPhase, getCrawlScarecrows, getVoteCounts } from "@/lib/stores/scarecrow-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

export const metadata: Metadata = {
  title: "Scarecrow Crawl",
  description:
    "Find every scarecrow in Kingston, vote for your favourite, and share it — Saturday 17 October to 5pm Saturday 31 October 2026.",
};

// Rendered per request, not prerendered, for the preview: the bare
// assertPageVisible gate reads the session, so while the page is hidden the
// Chamber can open it and see exactly what the public will get — entries,
// map, vote and all — behind a banner, and everyone else gets a 404. The
// static gate cannot do that (it never touches the session), and the crawl
// needs to be checked before it goes up far more than it needs to be a
// prerendered page.
export const dynamic = "force-dynamic";

export default async function ScarecrowPage() {
  const hiddenPreview = await assertPageVisible("/scarecrow");
  const [copy, scarecrows, resolved, phase] = await Promise.all([
    getCopyOverrides(),
    getCrawlScarecrows(),
    resolveMapView(CRAWL_VIEW_ID),
    getCrawlPhase(),
  ]);
  // Results stay shut until the crawl does. Before then the page never reads a
  // count, so there is no number to leak, cache, or argue with mid-contest.
  const counts = phase === "closed" ? await getVoteCounts() : {};
  const registering = registrationOpen();

  // A crawl marker still on the placeholder point has not been placed yet —
  // registered without coordinates, or added on the console without them.
  // It stays OFF the public map until someone drags it into place, so no pin
  // ever sits where the scarecrow isn't; it is still listed below, with the
  // address the business gave. Only markers: a route drawn on the view keeps
  // showing.
  const mapView = resolved
    ? {
        ...resolved,
        features: resolved.features.filter((f) => f.kind !== "marker" || !isUnplaced(f.point)),
      }
    : resolved;

  const ranked =
    phase === "closed"
      ? scarecrows
          .map((s) => ({ scarecrow: s, votes: counts[s.id] ?? 0 }))
          .sort((a, b) => b.votes - a.votes || a.scarecrow.title.localeCompare(b.scarecrow.title))
      : [];

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "scarecrow.header.eyebrow")}
        title={copyText(copy, "scarecrow.header.title")}
        intro={copyText(copy, "scarecrow.header.intro")}
      />

      {registering ? (
        <Section title="Register your scarecrow">
          <p className="mb-4 text-ink">
            Building a scarecrow for the crawl? Tell us about it here. The Chamber checks each entry
            and it appears on this page once approved. Registration closes when the crawl opens on
            Saturday 17 October.
          </p>
          <ScarecrowRegister />
        </Section>
      ) : null}

      {scarecrows.length === 0 ? (
        <Section>
          <p className="text-ink">
            {registering
              ? "No scarecrows on the trail yet — approved entries will appear here."
              : "The Chamber is still putting this year\u2019s trail together. Check back soon."}
          </p>
        </Section>
      ) : (
        <>
          <Section>
            <ScarecrowVote
              scarecrows={scarecrows.map((s) => ({
                id: s.id,
                title: s.title,
                ...(s.creator ? { creator: s.creator } : {}),
                ...(s.notes ? { notes: s.notes } : {}),
              }))}
              phase={phase}
            />
          </Section>

          <Section title="Where the scarecrows are">
            <p className="mb-4 text-ink">
              Tap a pin for the business hosting it. Everything on this map is within a walk of
              downtown Kingston.
            </p>
            <FeatureMap resolved={mapView} height="460px" />
          </Section>

          <Section title="Every scarecrow, in words">
            <ul className="space-y-4">
              {scarecrows.map((s) => (
                <li key={s.id}>
                  <h3 className="font-semibold text-ink">{s.title}</h3>
                  {s.creator ? <p className="text-ink">by {s.creator}</p> : null}
                  {s.notes ? <p className="text-ink-soft">{s.notes}</p> : null}
                  {s.placed ? null : (
                    <p className="text-xs text-ink-soft">Not on the map yet.</p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {phase === "closed" && scarecrows.length > 0 ? (
        <Section title="Results">
          <p className="mb-4 text-ink-soft">
            Votes are counted once per device, not per person — a good measure of which scarecrow
            people liked, not an audited ballot.
          </p>
          <ol className="space-y-2">
            {ranked.map(({ scarecrow, votes }) => (
              <li key={scarecrow.id} className="text-ink">
                <span className="font-semibold">{scarecrow.title}</span>
                {scarecrow.creator ? ` by ${scarecrow.creator}` : ""} · {votes}{" "}
                {votes === 1 ? "vote" : "votes"}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}
