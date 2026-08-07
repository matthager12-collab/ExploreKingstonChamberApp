// /admin/feedback — what visitors said through the site-wide feedback tab.
//
// Server component, force-dynamic for the same reason the insights dashboard
// is: these numbers must be fresh on every load, never a build-time snapshot.
// Access is gated by src/app/(site)/admin/layout.tsx (admin role required);
// /api/feedback's GET re-checks independently, because route handlers bypass
// layouts entirely.
//
// Windowed by the SAME analytics baseline as /admin, so "since <date>" means
// one thing across both pages. A visitor-facing count that silently used a
// different window than the dashboard beside it is the bug that costs the
// Chamber a grant number.

import type { Metadata } from "next";

import { Callout, Card, PageHeader, Section } from "@/components/ui";
import { feedbackStore, FEEDBACK_PAGE_SIZE } from "@/lib/feedback-store";
import { getAnalyticsBaseline } from "@/lib/stores/analytics-baseline-store";
import { FEEDBACK_MAX_RATING, FEEDBACK_MIN_RATING, REDACTED_PATH } from "@/lib/types";
import { CommentList } from "./comment-list";

export const metadata: Metadata = {
  title: "Page feedback",
  description: "Star ratings and comments visitors sent from the site's feedback tab.",
};

export const dynamic = "force-dynamic";

/** Source pages listed before truncating — keeps the table scannable. */
const TOP_N = 15;

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <Card>
      <p className="text-3xl font-semibold text-sound-deep">{value}</p>
      <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      {sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
    </Card>
  );
}

/**
 * Star rating as text plus glyphs. The NUMBER carries the meaning and the
 * stars only reinforce it — the same rule the insights dashboard's RatingChip
 * follows, for the same reason: a glyph-only signal is unreadable to a board
 * member using a screen reader, and "★★★☆☆" announces as noise.
 */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true" className="text-coral">
        {"★".repeat(rating)}
      </span>
      <span aria-hidden="true" className="text-sand">
        {"★".repeat(Math.max(0, FEEDBACK_MAX_RATING - rating))}
      </span>
      <span className="sr-only">
        {rating} of {FEEDBACK_MAX_RATING} stars
      </span>
    </span>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="text-sm text-ink-soft">{children}</p>;
}

/** A stored path, rendered as a link to the page it came from — except the
 *  privacy placeholder and the unknown bucket, which are not routes. */
function PathCell({ path }: { path: string }) {
  if (path === REDACTED_PATH || !path.startsWith("/")) {
    return <span className="text-ink-soft italic">{path}</span>;
  }
  return (
    <a href={path} className="font-medium break-all text-tide-deep underline">
      {path}
    </a>
  );
}

export default async function AdminFeedbackPage() {
  // Baseline first: it IS the window both reads below take.
  const baseline = await getAnalyticsBaseline();
  const since = baseline?.since ?? undefined;
  const [summary, recent] = await Promise.all([
    feedbackStore.summarize(since),
    // Rows, not bare responses: each carries the `ts` the delete control
    // addresses it by (feedback_response is a log with no id).
    feedbackStore.listRows(since),
  ]);

  // Descending stars: people scan a rating distribution from best to worst,
  // and the one-star row is what the Chamber is here to read.
  const ratingRows = [];
  for (let r = FEEDBACK_MAX_RATING; r >= FEEDBACK_MIN_RATING; r--) {
    ratingRows.push({ rating: r, count: summary.byRating[r] ?? 0 });
  }
  const maxRatingCount = Math.max(1, ...ratingRows.map((r) => r.count));

  const withComment = recent.filter((r) => r.response.comment);
  const topPaths = summary.byPath.slice(0, TOP_N);

  return (
    <>
      <PageHeader
        eyebrow="Chamber dashboard"
        title="Page feedback"
        intro="Ratings and comments people sent from the feedback tab, and which page they were on when they sent them. Anonymous — the widget never asks for a name or contact details."
      />

      <Section>
        <Callout title="How long this is kept">
          Feedback comments are free text, so they are held to the shortest retention
          window on the site — <strong>12 months</strong>, then deleted automatically.
          Act on anything here well before then; the published schedule is on the{" "}
          <a href="/privacy" className="font-medium text-tide-deep underline">
            privacy page
          </a>
          .{" "}
          {baseline?.since && (
            <>
              Every figure below counts feedback received since{" "}
              {new Date(baseline.since).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}{" "}
              — the same counting window as{" "}
              <a href="/admin" className="font-medium text-tide-deep underline">
                Visitor Insights
              </a>
              .
            </>
          )}
        </Callout>
      </Section>

      <Section title="At a glance">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard value={String(summary.total)} label="Submissions" />
          <StatCard
            value={summary.averageRating === null ? "—" : summary.averageRating.toFixed(1)}
            label="Average rating"
            sub={`out of ${FEEDBACK_MAX_RATING}`}
          />
          <StatCard
            value={String(summary.withComment)}
            label="Included a comment"
            sub={
              summary.total > 0
                ? `${Math.round((summary.withComment / summary.total) * 100)}% of submissions`
                : undefined
            }
          />
        </div>
      </Section>

      <Section title="Rating breakdown">
        {summary.total === 0 ? (
          <EmptyNote>No feedback yet. The tab is live on every public page.</EmptyNote>
        ) : (
          <Card>
            <ul>
              {ratingRows.map((row) => (
                <li key={row.rating} className="flex items-center gap-3 py-2">
                  <span className="w-24 shrink-0 text-sm">
                    <Stars rating={row.rating} />
                  </span>
                  {/* Bar is decorative — the count beside it is the real
                      value, so the bar carries aria-hidden rather than a
                      role="meter" nobody needs. */}
                  <span aria-hidden="true" className="h-2 flex-1 rounded-full bg-sand">
                    <span
                      className="block h-2 rounded-full bg-tide"
                      style={{ width: `${(row.count / maxRatingCount) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-sound-deep">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section
        title="By page"
        subtitle="Where the feedback came from. A low average on one page is the most actionable signal here."
      >
        {topPaths.length === 0 ? (
          <EmptyNote>Nothing yet.</EmptyNote>
        ) : (
          <Card>
            <ul className="divide-y divide-sand">
              {topPaths.map((row) => (
                <li key={row.path} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <PathCell path={row.path} />
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3 text-sm">
                    <span className="text-ink-soft">
                      avg <strong className="text-sound-deep">{row.averageRating.toFixed(1)}</strong>
                    </span>
                    <span className="font-semibold tabular-nums text-sound-deep">
                      {row.count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {summary.byPath.length > TOP_N && (
              <p className="mt-3 text-xs text-ink-soft">
                Showing the {TOP_N} pages with the most feedback, of {summary.byPath.length}.
              </p>
            )}
          </Card>
        )}
      </Section>

      <Section
        title="Comments"
        subtitle="Newest first. Read these — the star average tells you there's a problem; these tell you what it is."
      >
        {/* Client component: each row carries a Delete control, which is the
            mechanism behind the privacy notice's promise that a visitor can
            have their comment removed before the 12-month window elapses. */}
        <CommentList rows={withComment} />
        {recent.length >= FEEDBACK_PAGE_SIZE && (
          <p className="mt-3 text-xs text-ink-soft">
            Showing the most recent {FEEDBACK_PAGE_SIZE} submissions.
          </p>
        )}
      </Section>
    </>
  );
}
