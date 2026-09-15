// Chamber-facing Scarecrow Crawl console: the running count and the photos.
//
// The COUNT IS HERE AND NOT ON THE PUBLIC PAGE while voting is open — the
// Chamber can watch the crawl without the page starting a bandwagon or handing
// anyone a number to argue with. The public page publishes results once voting
// closes.
//
// Page access is admin-gated by the /admin layout; the photo stream and the
// removal endpoint are gated in their own handlers, because route handlers
// bypass layouts.

import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";
import { CRAWL_END, CRAWL_START, SCARECROWS, crawlPhase, scarecrowById } from "@/lib/data/scarecrows";
import {
  countVotes,
  getVoteCounts,
  listVotesWithPhotos,
  photoUrl,
} from "@/lib/stores/scarecrow-store";
import { PhotoList, type CrawlPhoto } from "./photo-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scarecrow Crawl",
  description: "Running vote counts and the photos visitors sent in.",
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
  const [counts, total, withPhotos] = await Promise.all([
    getVoteCounts(),
    countVotes(),
    listVotesWithPhotos(),
  ]);
  const phase = crawlPhase();

  const ranked = [...SCARECROWS]
    .map((s) => ({ scarecrow: s, votes: counts[s.id] ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.scarecrow.business.localeCompare(b.scarecrow.business));

  const photos: CrawlPhoto[] = withPhotos.map((vote) => ({
    id: vote.id,
    label: scarecrowById(vote.scarecrowId)?.title ?? vote.scarecrowId,
    when: formatWhen(vote.createdAt),
    src: photoUrl(vote.id),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Experiences"
        title="Scarecrow Crawl"
        intro="Who is winning, and the photos visitors sent with their votes."
      />

      <Section title="Votes">
        <p className="mb-4 text-ink-soft">
          {phase === "before"
            ? `Voting opens ${formatDay(CRAWL_START)}.`
            : phase === "open"
              ? `Voting is open until ${formatDay(CRAWL_END)}. The public page shows results only after that.`
              : `Voting closed ${formatDay(CRAWL_END)}. Results are on the public page.`}{" "}
          {total} {total === 1 ? "vote" : "votes"} so far. One vote per device, not per person —
          treat it as an interest signal, not a ballot.
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

      <Section title="Photos">
        <p className="mb-4 text-ink-soft">
          Visitors are told these reach the Chamber only and are never published. Location data is
          stripped before storage, and everything here is deleted after 12 months.
        </p>
        <PhotoList photos={photos} />
      </Section>
    </>
  );
}
