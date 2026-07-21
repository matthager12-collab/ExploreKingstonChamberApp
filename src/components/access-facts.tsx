// E27 — read-only display of verified place-level access facts (M-14-05, app
// slice) with the report-inaccuracy hand-off.
//
// Chamber-authored facts ONLY. Nothing a visitor submits appears here: the
// "Report an issue" affordance below is E08's existing intake, which files a
// moderation-queue item for a human. That is the moderation-before-publication
// floor — this component has no write path of its own.
//
// The honest-freshness rule is the whole design:
//   - a fact is shown only when someone recorded it; "unknown" renders nothing
//   - a venue with no facts renders NO block at all, rather than a wall of
//     "Not checked" that looks like a verdict
//   - when a fact exists but was never verified in person, the block says so
// Overclaiming here is worse than silence: someone plans a trip around a
// step-free entrance that isn't there.

import { ReportInaccurate } from "@/components/report-inaccurate";
import {
  ACCESS_ANSWER_LABELS,
  type AccessAnswer,
  type AccessFacts,
} from "@/lib/schemas/access";

/** Answers worth showing. "unknown" is silence, not a row. */
function shown(answer: AccessAnswer | undefined): answer is Exclude<AccessAnswer, "unknown"> {
  return answer !== undefined && answer !== "unknown";
}

const ROWS: { key: keyof AccessFacts; label: string }[] = [
  { key: "stepFreeEntrance", label: "Step-free entrance" },
  { key: "accessibleRestroom", label: "Accessible restroom" },
  { key: "accessibleParking", label: "Accessible parking" },
];

export function AccessFactsBlock({
  facts,
  store,
  id,
  subject,
  showReport = true,
}: {
  facts: AccessFacts;
  /** Moderated store name for the report hand-off, e.g. "restaurants". */
  store: string;
  id: string;
  subject?: string;
  /** Set false where the host card ALREADY mounts <ReportInaccurate> (e.g. the
   *  /eat and /stay listing cards). One report link per listing covers its
   *  access facts too; two would just look like a bug. */
  showReport?: boolean;
}) {
  const rows = ROWS.filter((r) => shown(facts[r.key] as AccessAnswer | undefined));
  if (rows.length === 0 && !facts.accessNotes) return null;

  return (
    <div className="mt-3 rounded-xl border border-sand bg-shell p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Access</h4>
      <dl className="mt-1.5 space-y-1">
        {rows.map((row) => {
          const answer = facts[row.key] as Exclude<AccessAnswer, "unknown">;
          return (
            <div key={row.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <dt className="text-ink-soft">{row.label}</dt>
              {/* The answer is TEXT — never a colour or an icon alone. */}
              <dd className="font-semibold text-ink">{ACCESS_ANSWER_LABELS[answer]}</dd>
            </div>
          );
        })}
      </dl>

      {facts.accessNotes && <p className="mt-1.5 text-sm text-ink-soft">{facts.accessNotes}</p>}

      <p className="mt-2 text-xs text-ink-soft">
        {facts.accessVerifiedOn
          ? `Checked ${facts.accessVerifiedOn}${facts.accessSource ? ` · ${facts.accessSource}` : ""}.`
          : "Not verified in person yet — call ahead if it matters for your visit."}
      </p>

      {/* E08's intake, reused — no new report backend. Reports become a
          moderation-queue item; nothing a visitor writes is published here. */}
      {showReport && (
        <div className="mt-2">
          <ReportInaccurate store={store} id={id} subject={subject} />
        </div>
      )}
    </div>
  );
}
