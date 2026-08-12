"use client";

// The lodging listing editor — the conservative sibling of the restaurant tabs.
//
// Members edit free text and links only: description, address, website,
// booking link, and tags. The lodging schema has no phone or hours fields, so
// none are offered; name and the type classification stay Chamber-controlled
// (the admin workbench edits those), mirroring how the restaurant editor never
// offers name or map placement. Saves ride the same PUT /api/portal/listing
// endpoint, so member writes hold for Chamber review exactly like restaurants.
//
// Rebuilt on the portal primitives: same payload, same endpoint, same copy.
// Its local Field helper, inputClass, buttonClass, PENDING_TEXT and hand-rolled
// busy/message pair are gone — useSave already owns all of that, and the two
// copies had already drifted (this one never showed a pending state on error).

import { useState, type FormEvent } from "react";
import type { Lodging } from "@/lib/types";
import {
  Button,
  FormSection,
  TextAreaField,
  TextField,
} from "@/components/portal/form";
import { SaveMessage, useSave } from "@/components/portal/business-save";

export function LodgingEditor({ initial }: { initial: Lodging }) {
  const [details, setDetails] = useState({
    description: initial.description,
    address: initial.address ?? "",
    website: initial.website ?? "",
    bookingUrl: initial.bookingUrl ?? "",
    tags: initial.tags.join(", "),
  });
  const detailsSave = useSave();

  const setD =
    (key: keyof typeof details) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDetails((d) => ({ ...d, [key]: e.target.value }));

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    void detailsSave.save(async () => {
      const res = await fetch("/api/portal/listing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: initial.id,
          description: details.description,
          address: details.address,
          website: details.website,
          bookingUrl: details.bookingUrl,
          tags: details.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        listing?: Lodging;
        pending?: boolean;
      };
      if (!res.ok || !data.listing) throw new Error(data.error ?? "Save failed");
      return Boolean(data.pending);
    }, "Saved — live on every page this listing appears.");
  }

  return (
    <FormSection
      title="Listing details"
      description="What visitors see on the stay page. Name and category changes go through the Chamber."
    >
      <form onSubmit={saveDetails} className="flex flex-col gap-5">
        <TextAreaField
          label="Description"
          value={details.description}
          onChange={setD("description")}
          rows={3}
          required
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Website"
            value={details.website}
            onChange={setD("website")}
            type="url"
            placeholder="https://…"
          />
          <TextField
            label="Booking link"
            value={details.bookingUrl}
            onChange={setD("bookingUrl")}
            type="url"
            placeholder="https://…"
          />
        </div>

        <TextField
          label="Address"
          hint="Optional — shown as a map link."
          value={details.address}
          onChange={setD("address")}
        />
        <TextField
          label="Tags"
          hint="Comma separated."
          value={details.tags}
          onChange={setD("tags")}
          placeholder="Waterfront, Dining on site, About 10 min drive"
        />

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" pending={detailsSave.busy}>
            Save details
          </Button>
          <SaveMessage message={detailsSave.message} />
        </div>
      </form>
    </FormSection>
  );
}
