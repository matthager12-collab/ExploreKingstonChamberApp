"use client";

// The Events tab: "Your events page" (suggested drafts) above the event editor.
// One client wrapper so a suggestion can be handed to the editor (Edit) and
// retired once the editor saves it. The server page stays thin.

import { useState } from "react";
import type { EventItem, Restaurant } from "@/lib/types";
import { EventPagePanel, retireDraft, type PanelDraft, type PanelPage } from "./event-page-panel";
import { EventsForm, type EventPrefill } from "./events-form";

export function EventsTab({
  ownerId,
  organizer,
  initialPage,
  initialDrafts,
  events,
  restaurant,
}: {
  ownerId: string;
  organizer: string;
  initialPage: PanelPage | null;
  initialDrafts: PanelDraft[];
  events: EventItem[];
  restaurant: Restaurant;
}) {
  const [drafts, setDrafts] = useState<PanelDraft[]>(initialDrafts);
  const [prefill, setPrefill] = useState<EventPrefill | null>(null);
  const [notice, setNotice] = useState("");

  async function saved(_event: EventItem, prefillKey: string | undefined) {
    setPrefill(null);
    if (!prefillKey) return;
    // The key is `<draftId>#<n>`; the draft id is hex, so '#' never appears in it.
    const draftId = prefillKey.split("#")[0];
    try {
      await retireDraft(ownerId, draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      setNotice("");
    } catch {
      // The event IS saved; keep the draft visible so nothing is lost, and say so.
      setNotice("Your event was saved, but its suggestion is still listed. Dismiss it to clear it.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <EventPagePanel
        ownerId={ownerId}
        organizer={organizer}
        initialPage={initialPage}
        drafts={drafts}
        setDrafts={setDrafts}
        onEdit={setPrefill}
        editing={prefill !== null}
      />
      <p role="status" aria-live="polite" className="text-sm font-semibold text-danger empty:hidden">
        {notice}
      </p>
      {/* Keyed on the event ids: EventsForm copies initialEvents into state once,
          so a draft published from the panel above (router.refresh) would not
          show until a full reload without a remount. */}
      <EventsForm
        key={events.map((e) => e.id).join(",")}
        initial={restaurant}
        initialEvents={events}
        prefill={prefill}
        onSaved={(e, key) => void saved(e, key)}
        onCancel={() => setPrefill(null)}
      />
    </div>
  );
}
