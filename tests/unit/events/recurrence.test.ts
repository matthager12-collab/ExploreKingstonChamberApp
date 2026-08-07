// Repeat presets: the translation between what a person picks and the RRULE
// stored on the event. The round-trip is the property that matters — a rule
// the form writes must be a rule the form can reopen, or a published series
// becomes uneditable.

import { describe, expect, it } from "vitest";
import {
  describeRepeat,
  isPresetRRule,
  MAX_SKIPPED_DATES,
  presetToRRule,
  rruleToPreset,
  weekdayOf,
  type RepeatPreset,
} from "@/lib/events/recurrence";
import { previewOccurrences } from "@/lib/events/recurrence-preview";
import { MAX_OCCURRENCES_PER_SERIES } from "@/lib/events/rrule-expand";

// 2026-08-08 17:00 PDT — a Saturday.
const SATURDAY_5PM = "2026-08-09T00:00:00.000Z";

/** The preview returns instants too (the form needs them to write EXDATEs);
 *  most assertions here only care about the dates a person would read. */
const dateKeys = (occurrences: { dateKey: string }[]) => occurrences.map((o) => o.dateKey);

describe("the skipped-date cap tracks the expander's cap", () => {
  it("MAX_SKIPPED_DATES equals MAX_OCCURRENCES_PER_SERIES", () => {
    // recurrence.ts duplicates this number to stay free of the `rrule`
    // package. If either side moves, this is the tripwire.
    expect(MAX_SKIPPED_DATES).toBe(MAX_OCCURRENCES_PER_SERIES);
  });
});

describe("presetToRRule", () => {
  it("weekly on one day", () => {
    expect(presetToRRule({ kind: "weekly", interval: 1, weekdays: ["SA"] })).toBe(
      "FREQ=WEEKLY;BYDAY=SA",
    );
  });

  it("every other week, multiple days, sorted Monday-first", () => {
    expect(
      presetToRRule({ kind: "weekly", interval: 2, weekdays: ["SU", "TH"] }),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,SU");
  });

  it("monthly on the same date takes its day from the event start", () => {
    // No BYMONTHDAY: DTSTART is the single anchor, so editing the event's
    // start moves the series with it.
    expect(presetToRRule({ kind: "monthly-date" })).toBe("FREQ=MONTHLY");
  });

  it("monthly on the nth weekday, including 'last'", () => {
    expect(presetToRRule({ kind: "monthly-weekday", ordinal: 2, weekday: "SU" })).toBe(
      "FREQ=MONTHLY;BYDAY=2SU",
    );
    expect(presetToRRule({ kind: "monthly-weekday", ordinal: -1, weekday: "FR" })).toBe(
      "FREQ=MONTHLY;BYDAY=-1FR",
    );
  });

  it("an end date becomes an UNTIL at the END of that Pacific day", () => {
    const rule = presetToRRule({
      kind: "weekly",
      interval: 1,
      weekdays: ["SA"],
      until: "2026-09-05",
    });
    // 2026-09-05 23:59:59 PDT is 2026-09-06 06:59:59Z — "through the 5th"
    // has to include the 5th.
    expect(rule).toBe("FREQ=WEEKLY;BYDAY=SA;UNTIL=20260906T065959Z");
  });

  it("does not repeat, and weekly with no day picked, produce no rule", () => {
    expect(presetToRRule({ kind: "none" })).toBeNull();
    expect(presetToRRule({ kind: "weekly", interval: 1, weekdays: [] })).toBeNull();
  });
});

describe("rruleToPreset — the round trip", () => {
  const cases: RepeatPreset[] = [
    { kind: "weekly", interval: 1, weekdays: ["SA"] },
    { kind: "weekly", interval: 2, weekdays: ["TH", "SU"] },
    { kind: "weekly", interval: 1, weekdays: ["SA"], until: "2026-09-05" },
    { kind: "monthly-date" },
    { kind: "monthly-weekday", ordinal: 2, weekday: "SU" },
    { kind: "monthly-weekday", ordinal: -1, weekday: "FR" },
    { kind: "monthly-weekday", ordinal: 3, weekday: "WE", until: "2027-01-31" },
  ];

  it.each(cases)("survives presetToRRule → rruleToPreset: %o", (preset) => {
    const rule = presetToRRule(preset);
    expect(rule).not.toBeNull();
    expect(rruleToPreset(rule!)).toEqual(preset);
  });

  it("an absent rule reads as 'does not repeat'", () => {
    expect(rruleToPreset(undefined)).toEqual({ kind: "none" });
  });

  it("returns null for rules outside the preset set rather than approximating", () => {
    // Silently rounding these to the nearest preset would rewrite a live
    // series, so the editor is told it cannot represent them instead.
    expect(rruleToPreset("FREQ=DAILY")).toBeNull();
    expect(rruleToPreset("FREQ=WEEKLY;INTERVAL=3;BYDAY=MO")).toBeNull();
    expect(rruleToPreset("FREQ=WEEKLY;BYDAY=MO;COUNT=10")).toBeNull();
    expect(rruleToPreset("FREQ=MONTHLY;BYSETPOS=2;BYDAY=MO,TU")).toBeNull();
    expect(rruleToPreset("FREQ=YEARLY")).toBeNull();
  });

  it("tolerates an RRULE: prefix and lowercase", () => {
    expect(rruleToPreset("rrule:freq=weekly;byday=sa")).toEqual({
      kind: "weekly",
      interval: 1,
      weekdays: ["SA"],
    });
  });
});

describe("isPresetRRule — the schema gate", () => {
  it("accepts what the form builds and rejects what it cannot reopen", () => {
    expect(isPresetRRule("FREQ=WEEKLY;BYDAY=SA")).toBe(true);
    expect(isPresetRRule("FREQ=MINUTELY")).toBe(false);
    expect(isPresetRRule("not a rule")).toBe(false);
  });
});

describe("weekdayOf", () => {
  it("reads the Pacific weekday of a series start", () => {
    expect(weekdayOf(SATURDAY_5PM)).toBe("SA");
  });

  it("uses the PACIFIC day, not UTC", () => {
    // 2026-08-09T00:00Z is Sunday in UTC but Saturday 5pm in Kingston.
    expect(new Date(SATURDAY_5PM).getUTCDay()).toBe(0); // Sunday, in UTC
    expect(weekdayOf(SATURDAY_5PM)).toBe("SA");
  });
});

describe("describeRepeat", () => {
  it("says it the way a person would", () => {
    expect(describeRepeat({ kind: "none" })).toBe("Does not repeat");
    expect(describeRepeat({ kind: "weekly", interval: 1, weekdays: ["SA"] })).toBe(
      "Every week on Saturday",
    );
    expect(describeRepeat({ kind: "weekly", interval: 2, weekdays: ["SA"] })).toBe(
      "Every 2 weeks on Saturday",
    );
    expect(
      describeRepeat({ kind: "weekly", interval: 1, weekdays: ["MO", "WE", "FR"] }),
    ).toBe("Every week on Monday, Wednesday and Friday");
    expect(describeRepeat({ kind: "monthly-weekday", ordinal: 2, weekday: "SU" })).toBe(
      "Every month on the second Sunday",
    );
    expect(
      describeRepeat({ kind: "weekly", interval: 1, weekdays: ["SA"], until: "2026-09-05" }),
    ).toBe("Every week on Saturday, through 2026-09-05");
  });
});

describe("previewOccurrences", () => {
  const NOW = new Date("2026-08-01T12:00:00.000Z");

  it("lists the next dates of a weekly series", () => {
    const rule = presetToRRule({ kind: "weekly", interval: 1, weekdays: ["SA"] })!;
    expect(dateKeys(previewOccurrences(rule, SATURDAY_5PM, [], 4, NOW))).toEqual([
      "2026-08-08",
      "2026-08-15",
      "2026-08-22",
      "2026-08-29",
    ]);
  });

  it("skips an exdate", () => {
    const rule = presetToRRule({ kind: "weekly", interval: 1, weekdays: ["SA"] })!;
    const preview = dateKeys(
      previewOccurrences(
        rule,
        SATURDAY_5PM,
        ["2026-08-16T00:00:00.000Z"], // the 8/15 Pacific occurrence
        4,
        NOW,
      ),
    );
    expect(preview).not.toContain("2026-08-15");
    expect(preview.slice(0, 3)).toEqual(["2026-08-08", "2026-08-22", "2026-08-29"]);
  });

  it("stops at the end date", () => {
    const rule = presetToRRule({
      kind: "weekly",
      interval: 1,
      weekdays: ["SA"],
      until: "2026-08-22",
    })!;
    expect(dateKeys(previewOccurrences(rule, SATURDAY_5PM, [], 6, NOW))).toEqual([
      "2026-08-08",
      "2026-08-15",
      "2026-08-22",
    ]);
  });

  it("holds the local time across the autumn DST flip", () => {
    // The reason recurrence math is not reimplemented here: a naive expander
    // drifts an hour on 2026-11-01 and the series lands on the wrong day at
    // the wrong time. Dates either side of the flip must stay Saturdays.
    const rule = presetToRRule({ kind: "weekly", interval: 1, weekdays: ["SA"] })!;
    const dates = dateKeys(previewOccurrences(rule, SATURDAY_5PM, [], 20, NOW));
    expect(dates).toContain("2026-10-31");
    expect(dates).toContain("2026-11-07");
  });

  it("a null rule previews as the single start date", () => {
    expect(dateKeys(previewOccurrences(null, SATURDAY_5PM, [], 6, NOW))).toEqual(["2026-08-08"]);
  });
});
