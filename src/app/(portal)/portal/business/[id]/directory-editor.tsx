"use client";

// The directory listing editor — imported member records, most of them still
// drafts. Members edit free text and links only; name and category changes go
// through the Chamber.
//
// Rebuilt on the portal primitives: same payload, same endpoint, same three
// outcomes. Its local Field helper, inputClass, buttonClass and hand-rolled
// busy/message pair are gone.

import { useState, type FormEvent } from "react";
import type { DirectoryListing } from "@/lib/types";
import {
  Button,
  FormSection,
  TextAreaField,
  TextField,
} from "@/components/portal/form";
import { PENDING_TEXT, SaveMessage, useSave } from "@/components/portal/business-save";

const DRAFT_TEXT =
  "Saved. Your listing isn't public yet — the Chamber reviews and publishes it.";
const LIVE_TEXT = "Saved — live on every page this listing appears.";

export function DirectoryEditor({
  initial,
  isDraft,
}: {
  initial: DirectoryListing;
  isDraft: boolean;
}) {
  const [details, setDetails] = useState({
    description: initial.description,
    address: initial.address ?? "",
    phone: initial.phone ?? "",
    website: initial.website ?? "",
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
          phone: details.phone,
          website: details.website,
          tags: details.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        listing?: DirectoryListing;
        pending?: boolean;
        draft?: boolean;
      };
      if (!res.ok || !data.listing) throw new Error(data.error ?? "Save failed");
      // Three outcomes, not two — returning the string keeps the draft case,
      // which is the one an owner most needs: it looks saved, and it is still
      // not public.
      return data.pending ? PENDING_TEXT : data.draft ? DRAFT_TEXT : LIVE_TEXT;
    }, LIVE_TEXT);
  }

  return (
    <FormSection
      title="Listing details"
      description={
        isDraft
          ? "What the Chamber (and later, visitors) see. Name and category changes go through the Chamber."
          : "What visitors see. Name and category changes go through the Chamber."
      }
    >
      <form onSubmit={saveDetails} className="flex flex-col gap-5">
        <TextAreaField
          label="Description"
          value={details.description}
          onChange={setD("description")}
          rows={4}
          placeholder="Tell visitors who you are, what you do, and what makes you worth a stop."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Phone"
            value={details.phone}
            onChange={setD("phone")}
            type="tel"
            placeholder="360-555-0100"
          />
          <TextField
            label="Website"
            value={details.website}
            onChange={setD("website")}
            type="url"
            placeholder="https://…"
          />
        </div>

        <TextField
          label="Address"
          value={details.address}
          onChange={setD("address")}
          placeholder="Street, Kingston, WA"
        />
        <TextField
          label="Tags"
          hint="Comma separated."
          value={details.tags}
          onChange={setD("tags")}
          placeholder="Downtown, Family friendly"
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
