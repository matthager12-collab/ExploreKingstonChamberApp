// The admin record editor's pure core: record → draft → record.
//
// The invariant worth a test is that a SAVE CANNOT LOSE STORED DATA. The form
// rebuilds each record from its field list, so any stored key without a
// control used to be deleted the next time an admin pressed Save — an event's
// repeat rule would vanish because someone fixed a typo in its title.

import { describe, expect, it } from "vitest";
import { eventFields, eventSchema } from "@/lib/schemas/event";
import type { DomainDef, GenericRecord } from "@/lib/schemas/form";
import {
  buildRecord,
  newRecordDraft,
  parseRepeatDraft,
  recordToDraft,
  serializeRepeatDraft,
} from "@/components/admin/record-draft";

const events: DomainDef = {
  key: "events",
  label: "Events",
  noun: "event",
  fields: eventFields,
  schema: eventSchema,
};

function liveEvent(extra: Record<string, unknown> = {}): GenericRecord {
  return {
    id: "kingston-public-market",
    title: "Kingston Public Market",
    start: "2026-08-08T09:00",
    venue: "Mike Wallace Park",
    description: "Produce, crafts, and music.",
    category: "market",
    organizer: "Kingston Chamber",
    ...extra,
  };
}

/** Save the record back unchanged, the way pressing Save with no edits does. */
function roundTrip(record: GenericRecord): GenericRecord {
  const built = buildRecord(events, recordToDraft(events, record));
  if (!built.ok) throw new Error(`${built.fieldKey}: ${built.text}`);
  return built.record;
}

describe("a save never drops a stored key the form does not render", () => {
  it("carries an unrendered key through untouched", () => {
    // charityId has no control in eventFields; it must survive anyway.
    const out = roundTrip(liveEvent({ charityId: "kingston-food-bank" }));
    expect(out.charityId).toBe("kingston-food-bank");
  });

  it("carries several at once, including a nested value", () => {
    const out = roundTrip(
      liveEvent({ ownerId: "org-1", attachments: ["blob://flyer.pdf"] }),
    );
    expect(out.ownerId).toBe("org-1");
    expect(out.attachments).toEqual(["blob://flyer.pdf"]);
  });

  it("a rendered field still wins over the carried copy", () => {
    // The form speaks for what it shows: an edited title must not be shadowed
    // by the stored one riding through as carried data.
    const draft = recordToDraft(events, liveEvent());
    draft.values.title = "Kingston Winter Market";
    const built = buildRecord(events, draft);
    expect(built.ok).toBe(true);
    expect(built.ok && built.record.title).toBe("Kingston Winter Market");
  });

  it("a new record carries nothing", () => {
    expect(newRecordDraft(events).carried).toEqual({});
  });
});

describe("the repeat control's two keys", () => {
  const weekly = "FREQ=WEEKLY;BYDAY=SA";

  it("round-trips a rule and its skipped dates", () => {
    const out = roundTrip(
      liveEvent({ rrule: weekly, exdates: ["2026-08-16T00:00:00.000Z"] }),
    );
    expect(out.rrule).toBe(weekly);
    expect(out.exdates).toEqual(["2026-08-16T00:00:00.000Z"]);
  });

  it("clearing the repeat clears the skipped dates with it", () => {
    // The stored pair is in `carried` as well, so "assign or delete" is what
    // makes clearing actually clear — assigning alone would let the old rule
    // ride through.
    const draft = recordToDraft(
      events,
      liveEvent({ rrule: weekly, exdates: ["2026-08-16T00:00:00.000Z"] }),
    );
    draft.values.rrule = serializeRepeatDraft({});
    const built = buildRecord(events, draft);
    expect(built.ok).toBe(true);
    expect(built.ok && built.record.rrule).toBeUndefined();
    expect(built.ok && built.record.exdates).toBeUndefined();
  });

  it("seeds the control from the record, not from one key", () => {
    const draft = recordToDraft(events, liveEvent({ rrule: weekly, exdates: ["x"] }));
    expect(parseRepeatDraft(draft.values.rrule)).toEqual({
      rrule: weekly,
      exdates: ["x"],
    });
  });

  it("neither key is treated as carried data", () => {
    // Otherwise the pair would be written by the control AND ride through as
    // untouched data, and clearing would depend on which won.
    const draft = recordToDraft(events, liveEvent({ rrule: weekly, exdates: ["x"] }));
    expect(draft.carried.rrule).toBeUndefined();
    expect(draft.carried.exdates).toBeUndefined();
  });

  it("survives a rule it cannot represent by rejecting the save, not rewriting it", () => {
    // A daily rule is outside the preset set; the schema refuses it rather
    // than letting the form quietly store something else.
    const draft = recordToDraft(events, liveEvent());
    draft.values.rrule = JSON.stringify({ rrule: "FREQ=DAILY" });
    const built = buildRecord(events, draft);
    expect(built.ok).toBe(false);
  });
});

describe("parseRepeatDraft", () => {
  it("treats blank and malformed input as no repeat", () => {
    expect(parseRepeatDraft("")).toEqual({});
    expect(parseRepeatDraft("not json")).toEqual({});
    expect(parseRepeatDraft(undefined)).toEqual({});
  });

  it("drops skipped dates that arrive without a rule", () => {
    expect(parseRepeatDraft(JSON.stringify({ exdates: ["x"] }))).toEqual({});
    expect(serializeRepeatDraft({ exdates: ["x"] })).toBe("");
  });
});
