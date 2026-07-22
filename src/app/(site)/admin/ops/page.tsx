// /admin/ops — the operator's single "is the app healthy?" page (E10 §5).
//
// Answers, without SSH or the Render dashboard: is the app healthy, when was the
// last backup, are the scheduled jobs running, are errors piling up? Server
// component, force-dynamic (never cached). EVERY probe is wrapped so nothing
// throws into the render and none blocks more than ~5 s: on a fresh clone (empty
// DATA_DIR, no DATABASE_URL, no Sentry, no mmdb) the page still returns 200 with
// every tile UNKNOWN. Probes run in-process — never fetch our own HTTP endpoint.
// Admin gate is the shared /admin layout; this page adds none of its own.
//
// Data-loading (impure: it reads the clock and hits probes) is isolated in
// loadOps() so the component render stays pure — the page only formats the
// snapshot loadOps() returns.

import type { Metadata } from "next";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import {
  FRESHNESS,
  fetchSentryErrorCount,
  freshnessStatus,
  probeDataDir,
  type OpsStatus,
} from "@/lib/ops-health";
import { probeDb } from "@/lib/db/ops-probe";
import { getMarkers, type OpsMarker } from "@/lib/stores/ops-markers-store";
import { getAccuracy, latestObservationAt } from "@/lib/stores/ferry-observations";
import { geoipEdition, geoipStatus } from "@/lib/geoip";

export const metadata: Metadata = { title: "Ops & status" };
export const dynamic = "force-dynamic";

const REPO = "https://github.com/matthager12-collab/ExploreKingstonChamberApp/blob/main";

/** Run a probe with a fallback + hard timeout so one slow/broken dependency can
 *  never stall or crash the page render. */
async function probe<T>(fn: () => Promise<T>, fallback: T, ms = 4500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Gather every probe + derive the section statuses. Isolated from the render so
 *  the impure clock read + I/O stay out of the (pure) component body. */
async function loadOps() {
  const now = Date.now();
  const [dataProbe, dbProbe, markers, observeAt, accuracy, sentry, geoip] =
    await Promise.all([
      probe(() => probeDataDir(), { ok: false, detail: "probe did not complete" }),
      probe(() => probeDb(), "unknown" as const),
      probe(() => getMarkers(), [] as OpsMarker[]),
      probe(() => latestObservationAt(), null as string | null),
      probe(() => getAccuracy(), { latest: null, history: [] }),
      probe(() => fetchSentryErrorCount(), {
        configured: false,
        count: null,
        dashboardUrl: "https://sentry.io/",
      }),
      probe(() => geoipStatus(), { present: false, edition: geoipEdition() }),
    ]);

  const backupMarker = markers.find((m) => m.id === "backup:last-success");
  const jobMarkers = markers.filter((m) => m.id.startsWith("job:"));

  const dataStatus: OpsStatus = dataProbe.ok ? "ok" : "warn";
  const dbStatus: OpsStatus =
    dbProbe === "ok" ? "ok" : dbProbe === "down" ? "warn" : "unknown";
  const backupStatus = freshnessStatus(
    typeof backupMarker?.at === "string" ? backupMarker.at : null,
    FRESHNESS.backupWarnMs,
    now,
  );
  const observeStatus = freshnessStatus(observeAt, FRESHNESS.observeWarnMs, now);
  const accuracyStatus = freshnessStatus(
    accuracy.latest?.computedAt ?? null,
    FRESHNESS.accuracyWarnMs,
    now,
  );
  const sentryStatus: OpsStatus = !sentry.configured
    ? "unknown"
    : sentry.count === null
      ? "unknown"
      : sentry.count > 0
        ? "warn"
        : "ok";
  const geoipStatusVal: OpsStatus = geoip.present
    ? freshnessStatus(geoip.mtimeIso ?? null, FRESHNESS.geoipWarnMs, now)
    : "unknown";

  // Quiet-by-default rollup: warn if anything warns, else ok if anything is ok,
  // else unknown (a fresh clone shows a calm neutral summary, not an alarm).
  const all = [
    dataStatus,
    dbStatus,
    backupStatus,
    observeStatus,
    accuracyStatus,
    sentryStatus,
    geoipStatusVal,
  ];
  const overall: OpsStatus = all.includes("warn")
    ? "warn"
    : all.includes("ok")
      ? "ok"
      : "unknown";

  return {
    now,
    dataProbe,
    dbProbe,
    backupMarker,
    jobMarkers,
    observeAt,
    accuracy,
    sentry,
    geoip,
    dataStatus,
    dbStatus,
    backupStatus,
    observeStatus,
    accuracyStatus,
    sentryStatus,
    geoipStatusVal,
    overall,
    commit: process.env.RENDER_GIT_COMMIT ?? "dev",
    fileCount:
      typeof backupMarker?.fileCount === "number" ? backupMarker.fileCount : undefined,
  };
}

function toneFor(s: OpsStatus): "green" | "coral" | "sand" {
  return s === "ok" ? "green" : s === "warn" ? "coral" : "sand";
}
function labelFor(s: OpsStatus): string {
  return s === "ok" ? "OK" : s === "warn" ? "WARN" : "UNKNOWN";
}
function StatusPill({ status }: { status: OpsStatus }) {
  return <Badge tone={toneFor(status)}>{labelFor(status)}</Badge>;
}

function ageOf(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}

function Row({
  label,
  value,
  status,
}: {
  label: string;
  value: React.ReactNode;
  status?: OpsStatus;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="font-medium text-ink">{label}</span>{" "}
        <span className="text-sm break-words text-ink-soft">{value}</span>
      </span>
      {status && <StatusPill status={status} />}
    </li>
  );
}

export default async function OpsPage() {
  const d = await loadOps();
  const overallLine =
    d.overall === "warn"
      ? "Something needs attention — check the WARN items below."
      : d.overall === "ok"
        ? "All monitored systems look normal."
        : "Not enough data yet — probes are in an unknown state.";

  return (
    <>
      <PageHeader eyebrow="Chamber admin" title="Ops & status" />

      <Section>
        <div className="flex items-center gap-3 rounded-2xl border border-sand bg-white p-4">
          <StatusPill status={d.overall} />
          <p className="text-sm text-ink-soft">{overallLine}</p>
        </div>
      </Section>

      <Section title="Service health">
        <Card>
          <ul className="divide-y divide-sand">
            <Row
              label="Data directory writable"
              value={d.dataProbe.ok ? "yes" : (d.dataProbe.detail ?? "no")}
              status={d.dataStatus}
            />
            <Row
              label="Database"
              value={
                d.dbProbe === "ok"
                  ? "reachable"
                  : d.dbProbe === "down"
                    ? "not answering"
                    : "not configured"
              }
              status={d.dbStatus}
            />
            <Row label="Deployed commit" value={d.commit} />
            <Row label="Server time" value={new Date(d.now).toISOString()} />
          </ul>
        </Card>
      </Section>

      <Section title="Backups">
        <Card>
          <ul className="divide-y divide-sand">
            <Row
              label="Last self-serve backup"
              value={
                d.backupMarker
                  ? `${d.backupMarker.at} (${ageOf(String(d.backupMarker.at), d.now)}${
                      d.fileCount !== undefined ? `, ${d.fileCount} files` : ""
                    })`
                  : "never recorded"
              }
              status={d.backupStatus}
            />
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="/api/admin/backup"
              className="rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white hover:bg-sound-deep"
            >
              ⤓ Download backup
            </a>
            <span className="text-xs text-ink-soft">
              Sensitive — the bundle contains account password hashes. Admin-only.
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Render also snapshots the disk daily (7-day restore). Rehearsed restore
            steps live in{" "}
            <a className="underline" href={`${REPO}/docs/runbooks/RESTORE-DRILL.md`}>
              docs/runbooks/RESTORE-DRILL.md
            </a>
            .
          </p>
        </Card>
      </Section>

      <Section title="Scheduled jobs">
        <Card>
          <ul className="divide-y divide-sand">
            <Row
              label="Ferry observation"
              value={d.observeAt ? `${d.observeAt} (${ageOf(d.observeAt, d.now)})` : "none yet"}
              status={d.observeStatus}
            />
            <Row
              label="Ferry accuracy snapshot"
              value={
                d.accuracy.latest?.computedAt
                  ? `${d.accuracy.latest.computedAt} (${ageOf(d.accuracy.latest.computedAt, d.now)})`
                  : "none yet"
              }
              status={d.accuracyStatus}
            />
            {d.jobMarkers.map((m) => (
              <Row
                key={m.id}
                label={m.id}
                value={`${m.at} (${ageOf(String(m.at), d.now)})`}
                status={freshnessStatus(String(m.at), FRESHNESS.observeWarnMs, d.now)}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-soft">
            Heads up: GitHub disables scheduled workflows after 60 days without
            commits — a quiet push re-arms them.
          </p>
        </Card>
      </Section>

      <Section title="Errors">
        <Card>
          <ul className="divide-y divide-sand">
            <Row
              label="Unresolved issues (24 h)"
              value={
                !d.sentry.configured ? (
                  <>
                    Sentry not connected —{" "}
                    <a className="underline" href={d.sentry.dashboardUrl}>
                      see the Sentry dashboard
                    </a>
                  </>
                ) : d.sentry.count === null ? (
                  <>
                    unavailable —{" "}
                    <a className="underline" href={d.sentry.dashboardUrl}>
                      open Sentry
                    </a>
                  </>
                ) : (
                  <>
                    {d.sentry.count}{" "}
                    <a className="underline" href={d.sentry.dashboardUrl}>
                      (open Sentry)
                    </a>
                  </>
                )
              }
              status={d.sentryStatus}
            />
          </ul>
        </Card>
      </Section>

      <Section title="Geo-IP">
        <Card>
          <ul className="divide-y divide-sand">
            <Row
              label={`GeoLite2 database (${d.geoip.edition})`}
              value={
                d.geoip.present
                  ? `installed, updated ${d.geoip.mtimeIso} (${ageOf(d.geoip.mtimeIso, d.now)})`
                  : "not installed — visitor geography shows “Unknown”"
              }
              status={d.geoipStatusVal}
            />
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* No-JS refresh: a plain POST form so the button works without client JS. */}
            <form method="post" action="/api/admin/geoip/refresh">
              <button
                type="submit"
                className="rounded-full border border-sound px-4 py-2 text-sm font-semibold text-sound hover:bg-sand"
              >
                Refresh now
              </button>
            </form>
            <a className="text-xs underline text-ink-soft" href={`${REPO}/docs/runbooks/GEOIP.md`}>
              GeoLite2 setup &amp; chore — docs/runbooks/GEOIP.md
            </a>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Looked up in memory only; the visitor IP is never stored — just coarse
            country/region/city.
          </p>
        </Card>
      </Section>

      <Section title="Runbooks">
        <Card>
          <ul className="divide-y divide-sand">
            <li className="py-2">
              <a className="underline" href={`${REPO}/docs/runbooks/RESTORE-DRILL.md`}>
                Restore drill
              </a>{" "}
              <span className="text-sm text-ink-soft">— rehearsed backup restore, both modes</span>
            </li>
            <li className="py-2">
              <a className="underline" href={`${REPO}/docs/runbooks/ALERTS.md`}>
                Alerts &amp; on-call
              </a>{" "}
              <span className="text-sm text-ink-soft">— who acts when the maintainer is away</span>
            </li>
            <li className="py-2">
              <a className="underline" href={`${REPO}/docs/runbooks/GEOIP.md`}>
                GeoLite2 chore
              </a>{" "}
              <span className="text-sm text-ink-soft">— the MaxMind license-key update task</span>
            </li>
          </ul>
        </Card>
      </Section>
    </>
  );
}
