"use client";

// The directory listing editor — the simplest sibling of ./editor.tsx and
// ./lodging-editor.tsx, for the imported-members domain (E16/E17).
//
// Members edit free text and contact facts: description, address, phone,
// website, and tags. Name and the category bucket stay Chamber-controlled,
// mirroring how lodging never offers name or type. Saves ride the same
// PUT /api/portal/listing endpoint; what happens next depends on the
// listing's publish state, and the success copy must say which one happened:
// a DRAFT saves in place (it has never been public — the owner iterates
// freely and the Chamber's review is the publish act), while an edit to a
// PUBLISHED listing holds for Chamber review like every other domain.

import { useState, type FormEvent, type ReactNode } from "react";
import type { DirectoryListing } from "@/lib/types";
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

const DRAFT_TEXT =
  "Saved. Your listing isn't public yet — the Chamber reviews and publishes it.";
const PENDING_TEXT = "Submitted — goes live after Chamber review.";

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
        setMessage({
          ok: true,
          text: data.pending
            ? PENDING_TEXT
            : data.draft
              ? DRAFT_TEXT
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
      subtitle={
        isDraft
          ? "What the Chamber (and later, visitors) see. Name and category changes go through the Chamber."
          : "What visitors see. Name and category changes go through the Chamber."
      }
    >
      <Card>
        <form onSubmit={saveDetails} className="space-y-4">
          <Field label="Description">
            <textarea
              value={details.description}
              onChange={setD("description")}
              rows={4}
              placeholder="Tell visitors who you are, what you do, and what makes you worth a stop."
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <input
                value={details.phone}
                onChange={setD("phone")}
                type="tel"
                placeholder="360-555-0100"
                className={inputClass}
              />
            </Field>
            <Field label="Website">
              <input
                value={details.website}
                onChange={setD("website")}
                type="url"
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={details.address}
              onChange={setD("address")}
              placeholder="Street, Kingston, WA"
              className={inputClass}
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              value={details.tags}
              onChange={setD("tags")}
              placeholder="Downtown, Family friendly"
              className={inputClass}
            />
          </Field>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? "Saving…" : "Save details"}
            </button>
            {message && (
              <p
                role="status"
                className={`text-sm font-medium ${message.ok ? "text-fern" : "text-coral-deep"}`}
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
