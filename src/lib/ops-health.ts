// The ops dashboard's probes + freshness policy, in one tunable place (E10 §5).
// Kept here (not in the page) so the thresholds are unit-testable and a future
// tweak is a one-line change. The data-dir write probe is ALSO consumed by
// /api/health, so both readiness surfaces share exactly one implementation.

import { mkdir, writeFile, unlink } from "fs/promises";
import { dataDir, dataPath } from "@/lib/data-dir";

/** Three visual states (FR-A31, "quiet by default"): UNKNOWN is neutral, NOT
 *  alarming — a probe with nothing to report is not a problem to solve. */
export type OpsStatus = "ok" | "warn" | "unknown";

// Freshness windows. A timestamped signal older than its window is WARN; an
// absent one is UNKNOWN. Each window is the job's cadence plus slack for
// scheduler delay, so a single missed run doesn't flip the tile.
export const FRESHNESS = {
  /** Backup download marker + off-site job; ~a month of silence is wrong. */
  backupWarnMs: 35 * 24 * 60 * 60 * 1000,
  /** Observe cron runs every 15 min; 2 h absorbs a couple of missed GH-Actions runs. */
  observeWarnMs: 2 * 60 * 60 * 1000,
  /** Accuracy cron runs daily at 08:00 UTC; 48 h = one full miss of slack. */
  accuracyWarnMs: 48 * 60 * 60 * 1000,
  /** DB-IP is baked in at build and updates monthly; 40 d stale means the
   *  service hasn't been redeployed in over a month (the way to refresh it). */
  geoipWarnMs: 40 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Classify a timestamped signal. The FR-A31 policy lives here:
 *  - no timestamp (never recorded / not configured) → "unknown" (neutral) — the
 *    ops page must not cry wolf about a job that simply hasn't run yet;
 *  - older than `warnAfterMs` → "warn";
 *  - otherwise → "ok". A future timestamp (clock skew) is treated as fresh.
 */
export function freshnessStatus(
  iso: string | null | undefined,
  warnAfterMs: number,
  now: number = Date.now(),
): OpsStatus {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  return now - t > warnAfterMs ? "warn" : "ok";
}

/**
 * The data-dir write probe, extracted from /api/health so both surfaces share
 * one implementation. Surfaces the error message the health route swallowed —
 * safe on an admin-only ops page, but never expose the detail on a public
 * surface. (Uses the fixed `.health-probe` name the backup walk already excludes;
 * concurrent probes can race the unlink, a benign one-off at this cadence.)
 */
export async function probeDataDir(): Promise<{ ok: boolean; detail?: string }> {
  const probe = dataPath(".health-probe");
  try {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(probe, String(Date.now()), "utf8");
    await unlink(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface SentryStatus {
  configured: boolean;
  /** Unresolved issues in the last 24 h, or null when not configured/unavailable. */
  count: number | null;
  dashboardUrl: string;
}

/**
 * Unresolved-issue count from the Sentry API (last 24 h) when the three ops vars
 * are set; otherwise a "not connected" result with a plain dashboard link. Never
 * throws and never blocks the page for more than ~4 s — a Sentry hiccup must not
 * take down the ops page.
 */
export async function fetchSentryErrorCount(): Promise<SentryStatus> {
  const token = process.env.SENTRY_OPS_API_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG;
  const project = process.env.SENTRY_PROJECT_SLUG;
  if (!token || !org || !project) {
    return { configured: false, count: null, dashboardUrl: "https://sentry.io/" };
  }
  const dashboardUrl = `https://sentry.io/organizations/${org}/issues/?project=${project}`;
  try {
    const url =
      `https://sentry.io/api/0/projects/${org}/${project}/issues/` +
      `?query=is:unresolved&statsPeriod=24h`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { configured: true, count: null, dashboardUrl };
    const issues = (await res.json()) as unknown;
    return {
      configured: true,
      count: Array.isArray(issues) ? issues.length : null,
      dashboardUrl,
    };
  } catch {
    return { configured: true, count: null, dashboardUrl };
  }
}
