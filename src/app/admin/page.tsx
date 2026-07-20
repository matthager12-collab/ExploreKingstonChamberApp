// /admin — Visitor Insights dashboard for the Chamber's LTAC/JLARC reporting.
//
// Server component: reads the JSONL stores directly (no client JS, nothing to
// track here — the tracker itself skips /admin paths). force-dynamic because
// the numbers must be fresh on every load, never a cached build-time snapshot.
//
// NOTE: access is gated by src/app/admin/layout.tsx (admin role required).

import type { Metadata } from "next";
import { areaLabel, summarize, type AnalyticsSummary } from "@/lib/analytics-store";
import { surveyStore } from "@/lib/survey-store";
import { Badge, Callout, Card, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Visitor Insights",
  description:
    "Anonymous, aggregate visitor counts for the Chamber's lodging-tax (LTAC/JLARC) reporting.",
};

export const dynamic = "force-dynamic";

/** Rows shown per list before truncating — keeps the page scannable. */
const TOP_N = 12;

/** Survey distance bands in report order, with reader-friendly labels. */
const DISTANCE_BANDS: { key: string; label: string }[] = [
  { key: "local", label: "Local (under 10 miles)" },
  { key: "10-50mi", label: "10–50 miles" },
  { key: "50mi-plus", label: "50+ miles" },
  { key: "out-of-state", label: "Out of state" },
  { key: "international", label: "International" },
];

function geoLabel(g: AnalyticsSummary["sessionsByGeo"][number]): string {
  if (g.source === "dev-local") return "Local development traffic";
  const parts = [g.city, g.region, g.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown (no location headers)";
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <Card>
      <p className="text-3xl font-semibold text-sound-deep">{value}</p>
      <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      {sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
    </Card>
  );
}

function CountRow({
  primary,
  secondary,
  count,
}: {
  primary: string;
  secondary?: string;
  count: number;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="font-medium break-words text-ink">{primary}</span>
        {secondary && <span className="ml-2 text-xs break-all text-ink-soft">{secondary}</span>}
      </span>
      <span className="text-sm font-semibold tabular-nums text-sound-deep">{count}</span>
    </li>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="text-sm text-ink-soft">{children}</p>;
}

export default async function AdminPage() {
  const [analytics, survey] = await Promise.all([summarize(), surveyStore.summarize()]);

  const overnightPct =
    survey.total > 0 ? `${Math.round((survey.overnightCount / survey.total) * 100)}%` : "—";

  // Canonical bands first (shown even at zero once any responses exist),
  // then any unexpected keys so nothing in the file is silently hidden.
  const knownKeys = new Set(DISTANCE_BANDS.map((b) => b.key));
  const distanceRows = [
    ...DISTANCE_BANDS.map((b) => ({ label: b.label, count: survey.byDistance[b.key] ?? 0 })),
    ...Object.entries(survey.byDistance)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, count]) => ({ label: key, count })),
  ];

  const topPages = analytics.pageviewsByPath.slice(0, TOP_N);
  const topLinks = analytics.outboundLinks.slice(0, TOP_N);
  const topGeo = analytics.sessionsByGeo.slice(0, TOP_N);

  return (
    <>
      <PageHeader
        eyebrow="Chamber dashboard"
        title="Visitor Insights"
        intro="Anonymous, aggregate counts of how people use this site — the raw material for Kingston's lodging-tax (LTAC) grant reports. No names, no cookies, no precise locations; just totals."
      />

      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand bg-white p-4">
          <p className="text-sm text-ink-soft">
            Render snapshots the disk daily (7-day restore). For an off-site copy —
            accounts, listings, events, survey &amp; analytics — download a bundle any time.
            Backup status and system health live on{" "}
            <a href="/admin/ops" className="font-medium text-tide-deep underline">
              Ops &amp; status
            </a>
            .
          </p>
          <a
            href="/api/admin/backup"
            className="shrink-0 rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white hover:bg-sound-deep"
          >
            ⤓ Download backup
          </a>
        </div>
      </Section>

      <Section title="At a glance">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            value={String(analytics.uniqueSessions)}
            label="Visits (browser sessions)"
            sub={`${analytics.outboundClicks} outbound link taps recorded`}
          />
          <StatCard value={String(analytics.pageviews)} label="Pageviews" />
          <StatCard value={String(survey.total)} label="Survey responses" />
          <StatCard
            value={overnightPct}
            label="Stayed overnight (survey)"
            sub={
              survey.total > 0
                ? `${survey.overnightCount} of ${survey.total} responses · ${survey.totalLodgingNights} lodging nights reported`
                : "No survey responses yet"
            }
          />
        </div>
      </Section>

      <Section
        title="Where visitors come from"
        subtitle="Two views of the same question: coarse, automatic location from the connection, and self-reported distance from the anonymous survey."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-sound-deep">By connection</h3>
              <Badge tone="sand">Coarse, automatic</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Region and city are derived from connection headers — city-grained at best and
              often wrong at finer levels. Exact home zip codes come only from the survey.
            </p>
            {topGeo.length > 0 ? (
              <ul className="mt-3 divide-y divide-sand">
                {topGeo.map((g) => (
                  <CountRow
                    key={`${g.country}|${g.region}|${g.city}|${g.source}`}
                    primary={geoLabel(g)}
                    count={g.sessions}
                  />
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyNote>No visits recorded yet.</EmptyNote>
              </div>
            )}
            {analytics.sessionsByGeo.length > TOP_N && (
              <p className="mt-2 text-xs text-ink-soft">
                Showing top {TOP_N} of {analytics.sessionsByGeo.length} areas.
              </p>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-sound-deep">By survey distance band</h3>
              <Badge tone="teal">Self-reported</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              The 50+ miles and out-of-state counts are the figures JLARC asks about.
            </p>
            {survey.total > 0 ? (
              <ul className="mt-3 divide-y divide-sand">
                {distanceRows.map((row) => (
                  <CountRow key={row.label} primary={row.label} count={row.count} />
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyNote>No survey responses yet.</EmptyNote>
              </div>
            )}
          </Card>
        </div>
      </Section>

      <Section title="What they look at" subtitle="Pageviews per page, most viewed first.">
        <Card>
          {topPages.length > 0 ? (
            <ul className="divide-y divide-sand">
              {topPages.map((p) => (
                <CountRow key={p.path} primary={p.path} count={p.count} />
              ))}
            </ul>
          ) : (
            <EmptyNote>No pageviews recorded yet.</EmptyNote>
          )}
          {analytics.pageviewsByPath.length > TOP_N && (
            <p className="mt-2 text-xs text-ink-soft">
              Showing top {TOP_N} of {analytics.pageviewsByPath.length} pages.
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="Where we send them"
        subtitle="Taps on outbound links — menus, ordering, maps, bookings. Evidence the site drives visitors to local businesses."
      >
        <Card>
          {topLinks.length > 0 ? (
            <ul className="divide-y divide-sand">
              {topLinks.map((l) => (
                <CountRow
                  key={`${l.href}|${l.label}`}
                  primary={l.label}
                  secondary={hostOf(l.href)}
                  count={l.count}
                />
              ))}
            </ul>
          ) : (
            <EmptyNote>No outbound link taps recorded yet.</EmptyNote>
          )}
          {analytics.outboundLinks.length > TOP_N && (
            <p className="mt-2 text-xs text-ink-soft">
              Showing top {TOP_N} of {analytics.outboundLinks.length} links.
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="Where visitors go around town"
        subtitle="Opt-in location pings from the “what's open near me” feature, bucketed into named Kingston areas — never anything finer than about a block."
      >
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-sound-deep">
              {analytics.geoPings} location {analytics.geoPings === 1 ? "ping" : "pings"}
            </h3>
            <Badge tone="teal">Opt-in, coarse</Badge>
          </div>
          {analytics.geoPingsByArea.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {analytics.geoPingsByArea.map((row) => {
                const max = analytics.geoPingsByArea[0].count;
                const pct = max > 0 ? Math.max(4, Math.round((row.count / max) * 100)) : 0;
                return (
                  <li key={row.area}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink">{areaLabel(row.area)}</span>
                      <span className="text-sm font-semibold tabular-nums text-sound-deep">
                        {row.count}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-sand">
                      <div className="h-full rounded-full bg-tide" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-3">
              <EmptyNote>
                No location pings yet — they arrive when a visitor taps the near-me button on
                the Eat &amp; Drink page and accepts the browser location prompt.
              </EmptyNote>
            </div>
          )}
          <p className="mt-4 text-xs italic text-ink-soft">
            Pings are opt-in and coarse (rounded to about a block before storage), so treat
            these counts as a sample of visitor movement — not a census.
          </p>
        </Card>
      </Section>

      <Section>
        <Callout title="Using these numbers in your LTAC report" tone="coral">
          <p>
            Everything on this page is an anonymous aggregate — no names, accounts, cookies, IP
            addresses, or precise locations are ever stored — so these figures are suitable for
            the visitor counts that chapter 67.28 RCW recipients report to JLARC. Use the survey
            columns for the questions JLARC actually asks (travelers from 50+ miles, paid
            overnight stays and lodging nights); use sessions and outbound taps as supporting
            evidence of reach and of traffic sent to local businesses.
          </p>
          <p className="mt-2 font-semibold text-coral-deep">
            This dashboard is gated to admin accounts.
          </p>
        </Callout>
      </Section>
    </>
  );
}
