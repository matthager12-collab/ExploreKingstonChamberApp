"use client";

// Tab 2 of the business listing editor: weekly hours, with a live open/closed
// preview and the regenerated human-readable summary.
//
// Was "section b" of editor.tsx. State, the save payload and the formatter are
// moved across unchanged. The grid became a PrimaryWithRail-shaped split: the
// day editor is the subject, the preview is the rail beside it.

import { useEffect, useMemo, useState } from "react";
import type { Restaurant, WeeklyHours } from "@/lib/types";
import { getOpenStatus } from "@/lib/hours";
import {
  HoursEditor,
  emptyWeeklyHours,
  weeklyHoursIssues,
} from "@/components/portal/hours-editor";
import { Button, FormSection, TextField } from "@/components/portal/form";
import { SaveMessage, putListing, useSave } from "@/components/portal/business-save";

// ---------- the human-readable hours formatter ----------

const DAY_ORDER: (keyof WeeklyHours)[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<keyof WeeklyHours, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** "20:00" -> "8 pm", "09:30" -> "9:30 am", "00:00" -> "midnight", "12:00" -> "noon" */
function fmtTime(hhmm: string): string {
  if (hhmm === "00:00" || hhmm === "24:00") return "midnight";
  if (hhmm === "12:00") return "noon";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function fmtSpans(spans: [string, string][]): string {
  if (spans.length === 0) return "closed";
  return spans.map(([open, close]) => `${fmtTime(open)}–${fmtTime(close)}`).join(" & ");
}

/**
 * Regenerate the human-readable hours line from structured weekly hours,
 * grouping consecutive days with identical spans:
 * "Mon–Thu 11 am–9:30 pm, Fri–Sat 11 am–midnight, Sun closed".
 */
export function formatWeeklyHours(weekly: WeeklyHours): string {
  const groups: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const text = fmtSpans(weekly[DAY_ORDER[i]] ?? []);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.end = i;
    else groups.push({ start: i, end: i, text });
  }
  if (groups.every((g) => g.text === "closed")) return "Closed";
  return groups
    .map((g) => {
      const label =
        g.start === g.end
          ? DAY_LABEL[DAY_ORDER[g.start]]
          : `${DAY_LABEL[DAY_ORDER[g.start]]}–${DAY_LABEL[DAY_ORDER[g.end]]}`;
      return `${label} ${g.text}`;
    })
    .join(", ");
}

/**
 * If the stored hours string is our generated summary plus a suffix note,
 * recover the note so it survives a round-trip through the editor.
 */
function initialNote(r: Restaurant): string {
  if (!r.hours || !r.weeklyHours) return "";
  const base = formatWeeklyHours(r.weeklyHours);
  if (r.hours.startsWith(base) && r.hours.length > base.length) {
    return r.hours.slice(base.length).replace(/^\s*—\s*/, "").trim();
  }
  return "";
}

export function HoursForm({ initial }: { initial: Restaurant }) {
  const [weekly, setWeekly] = useState<WeeklyHours>(
    initial.weeklyHours ?? emptyWeeklyHours(),
  );
  const [note, setNote] = useState(() => initialNote(initial));
  const [verified, setVerified] = useState(initial.hoursVerified);
  const hoursSave = useSave();

  const summary = useMemo(() => formatWeeklyHours(weekly), [weekly]);
  const composedHours = note.trim() ? `${summary} — ${note.trim()}` : summary;
  const hoursIssues = weeklyHoursIssues(weekly);

  // Live open/closed preview — null until after mount so SSR and the first
  // client render agree; re-checks each minute like the public badge.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const kickoff = setTimeout(update, 0);
    const timer = setInterval(update, 60_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, []);
  const liveStatus = nowMs !== null ? getOpenStatus(weekly, new Date(nowMs)) : null;

  function saveHours() {
    void hoursSave.save(async () => {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Los_Angeles",
      });
      const result = await putListing({
        id: initial.id,
        weeklyHours: weekly,
        hours: composedHours,
        hoursVerified: today,
      });
      setVerified(result.listing.hoursVerified);
      return result.pending;
    }, "Hours saved and marked verified today. The open-now badge follows instantly.");
  }

  return (
    <FormSection
      title="Hours"
      description="Set them once here — the live open-now badge, the food pages, and your syndication feed all follow."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <HoursEditor value={weekly} onChange={setWeekly} />

        <div className="rounded-xl border border-border bg-surface-sunken p-4">
          <p className="text-xs font-semibold tracking-wide text-secondary">Live preview</p>
          <div className="mt-2">
            {liveStatus ? (
              // Contrast: this is a preview of <OpenBadge>, so it carries the
              // same tones. The tinted pairs it used to have failed AA at this
              // 12px size — text-fern on bg-fern/10 was 4.29:1 and text-ink-soft
              // on bg-sand 3.62:1. Solid fern with white text is 4.86:1 and sand
              // with text-ink is 11.95:1, matching src/components/open-badge.tsx.
              // A preview that renders differently from the badge it previews is
              // worse than useless, so these must stay in step.
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  liveStatus.open ? "bg-fern text-white" : "bg-sand text-ink"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    liveStatus.open ? "bg-white" : "bg-ink/40"
                  }`}
                  aria-hidden
                />
                {liveStatus.label}
              </span>
            ) : (
              <span className="text-xs text-ink-soft">Checking…</span>
            )}
          </div>

          <p className="mt-4 text-xs font-semibold tracking-wide text-secondary">
            How it will read
          </p>
          <p className="mt-1 text-sm text-ink">{composedHours}</p>

          <div className="mt-4">
            <TextField
              label="Note to append"
              hint="Optional."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="kitchen closes 30 min early"
            />
          </div>

          <p className="mt-3 text-xs text-ink-soft">
            {verified
              ? `Hours last verified ${verified}. Saving re-verifies them today.`
              : "These hours haven't been verified yet — saving marks them verified today."}
          </p>

          {hoursIssues.length > 0 && (
            <ul className="mt-3 space-y-1">
              {hoursIssues.map((issue) => (
                <li key={issue} className="text-xs font-semibold text-danger">
                  {issue}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <Button
              type="button"
              onClick={saveHours}
              pending={hoursSave.busy}
              disabled={hoursIssues.length > 0}
            >
              Save hours
            </Button>
          </div>
          <div className="mt-2">
            <SaveMessage message={hoursSave.message} />
          </div>
        </div>
      </div>
    </FormSection>
  );
}
