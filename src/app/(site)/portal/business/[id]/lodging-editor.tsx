"use client";

// The lodging listing editor — the conservative sibling of ./editor.tsx.
//
// Members edit free text and links only: description, address, website,
// booking link, and tags. The lodging schema has no phone or hours fields, so
// none are offered; name and the type classification stay Chamber-controlled
// (the admin workbench edits those), mirroring how the restaurant editor never
// offers name or map placement. Saves ride the same PUT /api/portal/listing
// endpoint, so member writes hold for Chamber review exactly like restaurants.

import { useState, type FormEvent, type ReactNode } from "react";
import type { Lodging } from "@/lib/types";
import { Card, Section } from "@/components/ui";

// ---------- shared styles (same vocabulary as ./editor.tsx) ----------

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

/** Member saves hold for Chamber review (E08); the API says so with
 *  `pending: true` and the success copy must not promise instant publish. */
const PENDING_TEXT = "Submitted — goes live after Chamber review.";

export function LodgingEditor({ initial }: { initial: Lodging }) {
  const [details, setDetails] = useState({
    description: initial.description,
    address: initial.address ?? "",
    website: initial.website ?? "",
    bookingUrl: initial.bookingUrl ?? "",
    tags: initial.tags.join(", "),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setD =
    (key: keyof typeof details) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDetails((d) => ({ ...d, [key]: e.target.value }));

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
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
        setMessage({
          ok: true,
          text: data.pending
            ? PENDING_TEXT
            : "Saved — live on every page this listing appears.",
        });
      } catch (err) {
        setMessage({
          ok: false,
          text: err instanceof Error ? err.message : "Something went wrong — try again",
        });
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <Section
      title="Listing details"
      subtitle="What visitors see on the stay page. Name and category changes go through the Chamber."
    >
      <Card>
        <form onSubmit={saveDetails} className="space-y-4">
          <Field label="Description">
            <textarea
              value={details.description}
              onChange={setD("description")}
              rows={3}
              required
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website">
              <input
                value={details.website}
                onChange={setD("website")}
                type="url"
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
            <Field label="Booking link">
              <input
                value={details.bookingUrl}
                onChange={setD("bookingUrl")}
                type="url"
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Address (optional — shown as a map link)">
            <input value={details.address} onChange={setD("address")} className={inputClass} />
          </Field>
          <Field label="Tags (comma separated)">
            <input
              value={details.tags}
              onChange={setD("tags")}
              placeholder="Waterfront, Dining on site, About 10 min drive"
              className={inputClass}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? "Saving…" : "Save details"}
            </button>
            {message && (
              <p
                className={`text-sm font-medium ${message.ok ? "text-fern" : "text-coral-deep"}`}
                role="status"
              >
                {message.text}
              </p>
            )}
          </div>
        </form>
      </Card>
    </Section>
  );
}
