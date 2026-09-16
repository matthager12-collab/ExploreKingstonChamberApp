"use client";

// Tab 1 of the business listing editor: the details visitors see.
//
// Was "section a" inside the 797-line editor.tsx. Its state, its change
// handler and its save payload are moved across UNCHANGED — same fields, same
// trimming, same endpoint, same success copy. What changed is the markup: the
// wrapping <label> helper and the local `inputClass` string are gone, replaced
// by the portal form primitives, which wire htmlFor and aria-describedby.

import { useState, type FormEvent } from "react";
import type { Restaurant } from "@/lib/types";
import {
  Button,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/portal/form";
import { SaveMessage, putListing, useSave } from "@/components/portal/business-save";

const PLATFORMS: { value: string; label: string }[] = [
  { value: "", label: "Not set" },
  { value: "toast", label: "Toast" },
  { value: "square", label: "Square" },
  { value: "doordash", label: "DoorDash" },
  { value: "own-site", label: "Our own website" },
  { value: "phone-only", label: "Phone orders only" },
];

export function ListingForm({ initial }: { initial: Restaurant }) {
  const [details, setDetails] = useState({
    description: initial.description,
    phone: initial.phone ?? "",
    website: initial.website ?? "",
    menuUrl: initial.menuUrl ?? "",
    orderingUrl: initial.orderingUrl ?? "",
    orderingPlatform: initial.orderingPlatform ?? "",
    cuisine: initial.cuisine,
    priceLevel: String(initial.priceLevel),
    tags: initial.tags.join(", "),
    address: initial.address,
  });
  const detailsSave = useSave();

  const setD =
    (key: keyof typeof details) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDetails((d) => ({ ...d, [key]: e.target.value }));

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    void detailsSave.save(async () => {
      const result = await putListing({
        id: initial.id,
        description: details.description,
        phone: details.phone,
        website: details.website,
        menuUrl: details.menuUrl,
        orderingUrl: details.orderingUrl,
        orderingPlatform: details.orderingPlatform,
        cuisine: details.cuisine,
        priceLevel: Number(details.priceLevel),
        tags: details.tags.split(",").map((t) => t.trim()).filter(Boolean),
        address: details.address,
      });
      return result.pending;
    }, "Saved — live on every page this listing appears.");
  }

  return (
    <FormSection
      title="Listing details"
      description="What visitors see on the food pages and the map."
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
          <TextField label="Phone" value={details.phone} onChange={setD("phone")} />
          <TextField
            label="Website"
            value={details.website}
            onChange={setD("website")}
            type="url"
            placeholder="https://…"
          />
          <TextField
            label="Menu link"
            value={details.menuUrl}
            onChange={setD("menuUrl")}
            type="url"
            placeholder="https://…"
          />
          <TextField
            label="Online ordering link"
            value={details.orderingUrl}
            onChange={setD("orderingUrl")}
            type="url"
            placeholder="https://…"
          />
          <SelectField
            label="Ordering platform"
            value={details.orderingPlatform}
            onChange={setD("orderingPlatform")}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Cuisine"
            value={details.cuisine}
            onChange={setD("cuisine")}
            required
          />
          <SelectField
            label="Price level"
            value={details.priceLevel}
            onChange={setD("priceLevel")}
          >
            <option value="1">$ — casual</option>
            <option value="2">$$ — mid-range</option>
            <option value="3">$$$ — special occasion</option>
          </SelectField>
          <TextField
            label="Tags"
            hint="Comma separated."
            value={details.tags}
            onChange={setD("tags")}
            placeholder="waterfront, kid-friendly, takeout"
          />
        </div>

        <TextField
          label="Address"
          value={details.address}
          onChange={setD("address")}
          required
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
