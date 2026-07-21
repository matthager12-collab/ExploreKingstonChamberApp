// E11 retention purge orchestrator: executes EXACTLY the entries of
// RETENTION_POLICY (src/lib/privacy/policy.ts) — the same manifest the
// public /privacy page renders, so the published schedule and the enforcing
// job cannot drift. Dry-run by default; --apply is the destructive path.
//
// HARDCODED AUDIT REFUSAL: the audit table is never purged, never edited —
// it is the Chamber's records floor and (post E16) the only membership
// history. This module has NO code path that touches the audit table
// destructively, and refuses to proceed if the manifest ever grows a
// time-windowed rule for it (assertAuditNeverPurged, run on every
// invocation; unit-tested).

import { RETENTION_POLICY, BELOW_K_BUCKET, K_FLOOR, type RetentionRule } from "./policy";
import {
  countGeoPingsInMonths,
  countNonGeoEventsBefore,
  countSurveyResponsesBefore,
  deleteNonGeoEventsBefore,
  deleteSurveyResponsesBefore,
  expiredGeoPingMonths,
  rollupAndDeleteMonth,
} from "@/lib/db/privacy-retention";
import { appendPrivacyAudit, heldRecordIds } from "@/lib/db/privacy-delete";
import { deleteSubmission, listSubmissions } from "@/lib/hunt-store";

export interface RetentionLine {
  store: string;
  action: RetentionRule["action"];
  /** Human-readable outcome for the CLI / route response. */
  note: string;
  /** Rows/events/files this run would delete (dry-run) or deleted (apply). */
  planned: number;
  applied?: number;
  /** Records skipped because a legal hold overrides deletion. */
  heldSkipped?: number;
}

export interface RetentionReport {
  mode: "dry-run" | "apply";
  ranAt: string;
  lines: RetentionLine[];
}

/** Guard: the manifest's audit entry must stay never-purge. Throws before
 *  ANY destructive work if someone edits the manifest out from under the
 *  floor. */
export function assertAuditNeverPurged(policy: readonly RetentionRule[] = RETENTION_POLICY): void {
  const audit = policy.find((r) => r.store === "audit");
  if (!audit || audit.action !== "never-purge") {
    throw new Error(
      "RETENTION_POLICY integrity failure: the audit entry must exist with action 'never-purge' — refusing to run any purge.",
    );
  }
}

function cutoffFor(rule: RetentionRule, now: Date): Date {
  const d = new Date(now);
  if (rule.windowDays !== undefined) {
    d.setDate(d.getDate() - rule.windowDays);
  } else if (rule.windowMonths !== undefined) {
    d.setMonth(d.getMonth() - rule.windowMonths);
  }
  return d;
}

/** Run the retention policy. `apply: false` (dry-run) reads counts and
 *  deletes NOTHING. `apply: true` executes and writes one metadata-only
 *  audit summary row. */
export async function runRetention(opts: {
  apply: boolean;
  now?: Date;
}): Promise<RetentionReport> {
  assertAuditNeverPurged();
  const now = opts.now ?? new Date();
  const lines: RetentionLine[] = [];

  for (const rule of RETENTION_POLICY) {
    switch (rule.store) {
      case "analytics-geo-pings": {
        const cutoff = cutoffFor(rule, now).toISOString();
        const months = await expiredGeoPingMonths(cutoff, now);
        const planned = await countGeoPingsInMonths(months);
        if (!opts.apply) {
          lines.push({
            store: rule.store,
            action: rule.action,
            planned,
            note:
              months.length > 0
                ? `would roll up + delete ${planned} geo-ping(s) across complete month(s): ${months.join(", ")}`
                : "no complete months past the window",
          });
          break;
        }
        let deleted = 0;
        for (const month of months) {
          const res = await rollupAndDeleteMonth(month, K_FLOOR, BELOW_K_BUCKET);
          deleted += res.deletedEvents;
        }
        lines.push({
          store: rule.store,
          action: rule.action,
          planned,
          applied: deleted,
          note: `rolled up + deleted ${deleted} geo-ping(s) across ${months.length} month(s)`,
        });
        break;
      }

      case "analytics-events": {
        const cutoff = cutoffFor(rule, now).toISOString();
        const planned = await countNonGeoEventsBefore(cutoff);
        const applied = opts.apply ? await deleteNonGeoEventsBefore(cutoff) : undefined;
        lines.push({
          store: rule.store,
          action: rule.action,
          planned,
          ...(applied !== undefined ? { applied } : {}),
          note: `${opts.apply ? "deleted" : "would delete"} ${planned} pageview/outbound/consent event(s) past ${rule.label}`,
        });
        break;
      }

      case "survey-responses": {
        const cutoff = cutoffFor(rule, now).toISOString();
        const planned = await countSurveyResponsesBefore(cutoff);
        const applied = opts.apply ? await deleteSurveyResponsesBefore(cutoff) : undefined;
        lines.push({
          store: rule.store,
          action: rule.action,
          planned,
          ...(applied !== undefined ? { applied } : {}),
          note: `${opts.apply ? "deleted" : "would delete"} ${planned} survey row(s) past ${rule.label}`,
        });
        break;
      }

      case "hunt-submissions": {
        const cutoff = cutoffFor(rule, now).toISOString();
        const expired = (await listSubmissions()).filter(
          (s) => s.ts < cutoff && typeof s.id === "string",
        );
        const ids = expired.map((s) => s.id as string);
        const held = await heldRecordIds("hunt-submissions", ids);
        const deletable = ids.filter((id) => !held.has(id));
        if (!opts.apply) {
          lines.push({
            store: rule.store,
            action: rule.action,
            planned: deletable.length,
            heldSkipped: held.size,
            note: `would delete ${deletable.length} submission(s) + photo(s) past ${rule.label}${held.size > 0 ? `; ${held.size} under legal hold (skipped, logged)` : ""}`,
          });
          break;
        }
        let applied = 0;
        const failures: string[] = [];
        // A hold set mid-run (after the snapshot) surfaces as deleteSubmission
        // returning "legal-hold" — collect those to reconcile too.
        const midRunHolds: string[] = [];
        for (const id of deletable) {
          try {
            const result = await deleteSubmission(id);
            if (result === "deleted") applied++;
            else if (result === "legal-hold") midRunHolds.push(id);
          } catch {
            failures.push(id); // photo delete failed → row kept, retry next run
          }
        }
        // The FR-A92 reconciliation: every hold-skip is logged, not silent —
        // both the up-front snapshot AND any hold that appeared mid-run.
        const allHeld = [...held, ...midRunHolds];
        for (const id of allHeld) {
          await appendPrivacyAudit({
            actor: "system",
            action: "retention-hold-skip",
            store: "hunt-submissions",
            recordId: id,
            detail: { reason: "legal hold overrides retention deletion" },
          });
        }
        lines.push({
          store: rule.store,
          action: rule.action,
          planned: deletable.length,
          applied,
          heldSkipped: allHeld.length,
          note: `deleted ${applied} submission(s) + photo(s)${failures.length > 0 ? `; ${failures.length} photo-delete failure(s), rows kept for retry` : ""}${allHeld.length > 0 ? `; ${allHeld.length} legal-hold skip(s) logged` : ""}`,
        });
        break;
      }

      case "worklist-request-contacts":
        lines.push({
          store: rule.store,
          action: rule.action,
          planned: 0,
          note: "contacts are redacted at request resolution (fulfillment-time, not cron-time)",
        });
        break;

      case "ferry-observations":
        lines.push({
          store: rule.store,
          action: rule.action,
          planned: 0,
          note: "self-pruning (src/lib/stores/ferry-observations.ts) — documented here, not executed",
        });
        break;

      case "audit":
        lines.push({
          store: rule.store,
          action: rule.action,
          planned: 0,
          note: "NEVER PURGED — hardcoded exclusion (records floor; carries the membership history post-E16)",
        });
        break;

      default:
        lines.push({
          store: rule.store,
          action: rule.action,
          planned: 0,
          note: "no executor for this store — manifest and orchestrator out of sync (fix before relying on the schedule)",
        });
    }

    // Incremental audit (D-10 durability): in apply mode, record each
    // destructive store's outcome the moment it completes — a mid-run crash
    // (a deploy restart, a DB error in a later store) then still leaves a
    // trail for every physical deletion already committed, instead of one
    // all-or-nothing summary that never gets written. Destructive executors
    // set `applied`; the inert ones (audit/ferry/worklist) do not.
    const line = lines[lines.length - 1];
    if (opts.apply && line.applied !== undefined) {
      await appendPrivacyAudit({
        actor: "system",
        action: "retention-purge",
        store: line.store,
        recordId: now.toISOString().slice(0, 10),
        detail: {
          planned: line.planned,
          applied: line.applied,
          heldSkipped: line.heldSkipped ?? 0,
        },
      });
    }
  }

  return {
    mode: opts.apply ? "apply" : "dry-run",
    ranAt: now.toISOString(),
    lines,
  };
}
