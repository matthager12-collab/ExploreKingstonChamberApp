"use client";

// Every event in one place, on the shared schema-driven record editor — the
// Chamber-wide counterpart to the per-business list in /portal/business/[id].
//
// WHY IT EXISTS. Events were the one content domain with no admin surface:
// eventFields and eventSchema had been written, but nothing rendered them, so
// the only way to fix a member's event was to open that member's portal page
// and know which one it was. Anything ingested from a feed, or created by an
// account since disabled, had no editor at all.
//
// One domain rather than tabs: /admin/listings groups four kinds of listing,
// and events are not a listing — they have owners, moderation state, and now a
// repeat rule. The editor takes a single-entry DOMAINS array happily.

import type { DomainDef, GenericRecord } from "@/lib/schemas/form";
import { eventFields, eventSchema } from "@/lib/schemas/event";
import { RecordEditor } from "@/components/admin/record-editor";
import type { MediaItem } from "@/lib/media/refs";

const DOMAINS: DomainDef[] = [
  {
    key: "events",
    label: "Events",
    noun: "event",
    publicPath: "/events",
    fields: eventFields,
    schema: eventSchema,
  },
];

export function EventsEditor({
  initial,
  photoLibrary,
}: {
  initial: GenericRecord[];
  photoLibrary: MediaItem[];
}) {
  return (
    <RecordEditor
      domains={DOMAINS}
      initial={{ events: initial }}
      // Events have no git seed — every record lives in the overlay, so there
      // is nothing to mark as "ships with the app" and nothing to restore by
      // clearing an override.
      seedIds={{ events: [] }}
      photoLibrary={photoLibrary}
    />
  );
}
