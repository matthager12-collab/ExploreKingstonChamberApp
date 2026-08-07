"use client";

// The repeat control — one component for both places an event gets edited
// (the business portal and the admin record editor), so a series set up in one
// reads and edits identically in the other.
//
// THE PREVIEW IS THE POINT. Everything else here is a dropdown; the list of
// real upcoming dates is what lets someone who has never heard of an RRULE see
// that "every month on the fifth Tuesday" produces four dates a year, or that
// their weekly market starts on the wrong Saturday. It is rendered by the same
// expander the calendar uses (recurrence-preview.ts), so it cannot flatter a
// rule the calendar will read differently.
//
// Bundle note: the preview pulls the `rrule` package client-side. That is paid
// only on the authenticated editor routes — Next code-splits per route, so no
// public page carries it.

import { useMemo } from "react";
import {
  describeRepeat,
  ORDINAL_LABEL,
  presetToRRule,
  rruleToPreset,
  WEEKDAY_LABEL,
  WEEKDAYS,
  weekdayOf,
  type Ordinal,
  type RepeatPreset,
  type Weekday,
} from "@/lib/events/recurrence";
import { previewOccurrences } from "@/lib/events/recurrence-preview";
import { pacificDateKey } from "@/lib/events/tz";

export interface RepeatValue {
  rrule?: string;
  exdates?: string[];
}

const ORDINALS: Ordinal[] = [1, 2, 3, 4, -1];

type PresetKind = RepeatPreset["kind"];

const KIND_LABEL: Record<PresetKind, string> = {
  none: "Does not repeat",
  weekly: "Every week",
  "monthly-date": "Every month, on this date",
  "monthly-weekday": "Every month, on a weekday",
};

/** An EXDATE instant as the Pacific date a person cancelled.
 *  NOT `slice(0, 10)`: an evening event's instant lands on the NEXT day in
 *  UTC, so slicing would show the market as skipped on the Sunday. */
function skippedDateLabel(instantIso: string): string {
  return pacificDateKey(instantIso);
}

export function RepeatField({
  startIso,
  value,
  onChange,
  idPrefix = "repeat",
  inputClass,
  labelClass,
}: {
  /** The series anchor — every rule is read relative to this. */
  startIso: string;
  value: RepeatValue;
  onChange: (next: RepeatValue) => void;
  idPrefix?: string;
  inputClass: string;
  labelClass: string;
}) {
  const preset = rruleToPreset(value.rrule);
  const exdates = value.exdates ?? [];

  // A rule we cannot represent (hand-written, or ingested from a feed). Say so
  // and leave it alone rather than rewriting it into the nearest preset — that
  // would silently change a published series.
  const unrepresentable = preset === null;

  // Joined rather than passed as an array so the dependency is a stable
  // primitive: a new [] every render would re-expand a year of occurrences on
  // every keystroke elsewhere in the form. Split back inside, which also keeps
  // every dependency a simple expression.
  const exdatesKey = exdates.join("|");
  const rrule = value.rrule ?? null;
  const occurrences = useMemo(
    () =>
      unrepresentable || !rrule
        ? []
        : previewOccurrences(rrule, startIso, exdatesKey ? exdatesKey.split("|") : [], 6),
    [rrule, startIso, exdatesKey, unrepresentable],
  );

  function emit(next: RepeatPreset, nextExdates: string[] = exdates) {
    const rrule = presetToRRule(next) ?? undefined;
    // Dropping the repeat drops its skipped dates with it — an exdate with no
    // series to subtract from is invisible clutter that would come back to
    // life if the series were ever re-enabled.
    onChange(rrule ? { rrule, exdates: nextExdates } : {});
  }

  function changeKind(kind: PresetKind) {
    const until = !unrepresentable && preset.kind !== "none" ? preset.until : undefined;
    const anchor = weekdayOf(startIso);
    if (kind === "none") return emit({ kind: "none" }, []);
    if (kind === "weekly")
      return emit({ kind: "weekly", interval: 1, weekdays: [anchor], ...(until ? { until } : {}) });
    if (kind === "monthly-date") return emit({ kind: "monthly-date", ...(until ? { until } : {}) });
    return emit({
      kind: "monthly-weekday",
      ordinal: 1,
      weekday: anchor,
      ...(until ? { until } : {}),
    });
  }

  if (unrepresentable) {
    return (
      <div className="rounded-xl border border-sand-deep bg-sand/30 p-3">
        <p className="text-sm font-medium text-sound-deep">This event repeats</p>
        <p className="mt-1 text-xs text-ink">
          Its repeat pattern was set outside this form, so it isn&rsquo;t shown here —
          saving won&rsquo;t change it. Ask the Chamber if it needs adjusting.
        </p>
      </div>
    );
  }

  const repeats = preset.kind !== "none";

  return (
    <div className="grid gap-3">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-kind`}>
          Repeats
        </label>
        <select
          id={`${idPrefix}-kind`}
          value={preset.kind}
          onChange={(e) => changeKind(e.target.value as PresetKind)}
          className={inputClass}
        >
          {(Object.keys(KIND_LABEL) as PresetKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {preset.kind === "weekly" && (
        <>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-interval`}>
              How often
            </label>
            <select
              id={`${idPrefix}-interval`}
              value={preset.interval}
              onChange={(e) =>
                emit({ ...preset, interval: e.target.value === "2" ? 2 : 1 })
              }
              className={inputClass}
            >
              <option value="1">Every week</option>
              <option value="2">Every 2 weeks</option>
            </select>
          </div>
          <fieldset>
            <legend className={labelClass}>On these days</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const on = preset.weekdays.includes(d);
                return (
                  <label
                    key={d}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium ${
                      on
                        ? "border-sound bg-sound text-white"
                        : "border-sand bg-white text-ink hover:border-tide"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        const weekdays: Weekday[] = on
                          ? preset.weekdays.filter((x) => x !== d)
                          : [...preset.weekdays, d];
                        // Never leave zero days selected: that builds no rule
                        // at all, and the form would silently stop repeating.
                        if (weekdays.length === 0) return;
                        emit({ ...preset, weekdays });
                      }}
                    />
                    {WEEKDAY_LABEL[d].slice(0, 3)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      {preset.kind === "monthly-weekday" && (
        <div className="flex flex-wrap gap-3">
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-ordinal`}>
              Which one
            </label>
            <select
              id={`${idPrefix}-ordinal`}
              value={preset.ordinal}
              onChange={(e) =>
                emit({ ...preset, ordinal: Number(e.target.value) as Ordinal })
              }
              className={inputClass}
            >
              {ORDINALS.map((o) => (
                <option key={o} value={o}>
                  {ORDINAL_LABEL[o]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-weekday`}>
              Day
            </label>
            <select
              id={`${idPrefix}-weekday`}
              value={preset.weekday}
              onChange={(e) => emit({ ...preset, weekday: e.target.value as Weekday })}
              className={inputClass}
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {repeats && (
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-until`}>
            Last date (optional)
          </label>
          <input
            id={`${idPrefix}-until`}
            type="date"
            value={preset.until ?? ""}
            onChange={(e) =>
              emit(
                e.target.value
                  ? { ...preset, until: e.target.value }
                  : ({ ...preset, until: undefined } as RepeatPreset),
              )
            }
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-soft">
            Leave blank to keep going. Seasonal series (summer concerts) should set
            this so they stop on their own.
          </p>
        </div>
      )}

      {repeats && (
        <div className="rounded-xl border border-sand bg-white p-3">
          <p className="text-sm font-semibold text-sound-deep">{describeRepeat(preset)}</p>
          <p className="mt-1 text-xs text-ink-soft">
            Next dates — check these look right before saving.
          </p>
          {occurrences.length === 0 ? (
            <p className="mt-2 text-sm text-coral-deep">
              This pattern produces no upcoming dates. Check the last date and the
              event&rsquo;s start.
            </p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {occurrences.map((occ) => (
                <li
                  key={occ.startIso}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-ink">{occ.dateKey}</span>
                  <button
                    type="button"
                    onClick={() => emit(preset, [...exdates, occ.startIso])}
                    className="text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                  >
                    Skip this one
                  </button>
                </li>
              ))}
            </ul>
          )}

          {exdates.length > 0 && (
            <div className="mt-3 border-t border-sand pt-2">
              <p className="text-xs font-semibold text-sound-deep">Skipped</p>
              <ul className="mt-1 grid gap-1">
                {exdates.map((x) => (
                  <li key={x} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-soft">{skippedDateLabel(x)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        emit(
                          preset,
                          exdates.filter((y) => y !== x),
                        )
                      }
                      className="text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                    >
                      Put it back
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
