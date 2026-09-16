// Chamber-facing Scarecrow Crawl console: the entries, the running count, and
// the photos.
//
// THE COUNT IS HERE AND NOT ON THE PUBLIC PAGE while voting is open — the
// Chamber can watch the crawl without the page starting a bandwagon or handing
// anyone a number to argue with. The public page publishes results once voting
// closes.
//
// The entry list writes through to the crawl map view, so this console and
// /admin/maps are two doors into the same data.
//
// Page access is admin-gated by the /admin layout; the photo stream, the
// removal endpoint and the map-features API are gated in their own handlers,
// because route handlers bypass layouts.

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/ui";
import { CRAWL_END, CRAWL_MAP_CENTER, CRAWL_START, CRAWL_VIEW_ID } from "@/lib/data/scarecrows";
import {
  countVotes,
  getCrawlPhase,
  getCrawlScarecrows,
  getVoteCounts,
  getVotingOverride,
  listVotesWithPhotos,
  photoUrl,
} from "@/lib/stores/scarecrow-store";
import { CrawlEditor, type EditableScarecrow } from "./crawl-editor";
import { PhotoList, type CrawlPhoto } from "./photo-list";
import { VotingControls } from "./voting-controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scarecrow Crawl",
  description: "Add the participating businesses, watch the vote, and review the photos.",
};

function formatWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminScarecrowPage() {
  const [scarecrows, counts, total, withPhotos, voting, phase] = await Promise.all([
    getCrawlScarecrows(),
    getVoteCounts(),
    countVotes(),
    listVotesWithPhotos(),
    getVotingOverride(),
    getCrawlPhase(),
  ]);

  const ranked: EditableScarecrow[] = scarecrows
    .map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.creator ? { creator: s.creator } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
      votes: counts[s.id] ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));

  // Votes cast for an entry that has since been taken off the map. Shown
  // rather than hidden: a total that does not reconcile sends someone hunting
  // for a bug that is really a deletion.
  const byId = new Set(scarecrows.map((s) => s.id));
  const orphans = Object.entries(counts).filter(([id]) => !byId.has(id));

  const photos: CrawlPhoto[] = withPhotos.map((vote) => ({
    id: vote.id,
    label: scarecrows.find((s) => s.id === vote.scarecrowId)?.title ?? vote.scarecrowId,
    when: formatWhen(vote.createdAt),
    src: photoUrl(vote.id),
    // Photos stored before the permission box existed have no answer on the
    // row. They read as "do not post", which is the only safe way to render a
    // consent nobody was asked for.
    socialOk: vote.photoSocialOk === true,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Experiences"
        title="Scarecrow Crawl"
        intro="The businesses taking part, who is winning, and the photos visitors sent with their votes."
      />

      <Section title="Entries">
        <p className="mb-4 text-ink-soft">
          {phase === "before"
            ? `Voting opens ${formatDay(CRAWL_START)}.`
            : phase === "open"
              ? `Voting is open until ${formatDay(CRAWL_END)}. The public page shows results only after that.`
              : `Voting closed ${formatDay(CRAWL_END)}. Results are on the public page.`}{" "}
          {total} {total === 1 ? "vote" : "votes"} so far — one per device, not per person, so read
          it as interest rather than a ballot. Changes here reach the public page within a minute.
          To move a pin, rename one, or add a photo to it, use the{" "}
          <Link href="/admin/maps" className="underline">
            map builder
          </Link>{" "}
          and pick the &ldquo;Scarecrow Crawl&rdquo; view.
        </p>

        <CrawlEditor
          scarecrows={ranked}
          viewId={CRAWL_VIEW_ID}
          defaultPoint={CRAWL_MAP_CENTER}
        />

        {orphans.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-ink">Votes for removed entries</h3>
            <ul className="mt-2 space-y-1 text-ink-soft">
              {orphans.map(([id, votes]) => (
                <li key={id}>
                  {id} · {votes} {votes === 1 ? "vote" : "votes"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Voting">
        <p className="mb-4 text-ink-soft">
          Force voting open to rehearse the whole thing — vote, photo, permission box — before the
          crawl starts, then clear the test votes and set it back to the dates. While the page is
          hidden, only signed-in Chamber staff can reach it, so a rehearsal reaches no visitors.
        </p>
        <VotingControls voting={voting} phase={phase} totalVotes={total} />
      </Section>

      <Section title="Photos">
        <p className="mb-4 text-ink-soft">
          Visitors are told these are not published on the page, and are asked whether the Chamber
          may use them on Facebook and Instagram — each photo says which answer it carries, and
          &ldquo;do not post&rdquo; means exactly that. Location data is stripped before storage,
          and everything here is deleted after 12 months.
        </p>
        <PhotoList photos={photos} />
      </Section>
    </>
  );
}
