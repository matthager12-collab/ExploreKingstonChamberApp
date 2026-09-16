"use client";

// Scarecrow Crawl — "register your scarecrow", for the businesses and makers
// taking part. Posts to /api/scarecrow/register, which holds the entry for
// the Chamber to approve; nothing here publishes anything.
//
// Two groups, kept apart the way the event-suggestion form keeps them:
//   - the scarecrow → PUBLIC once approved (name, who made it, where it is);
//   - about you → PRIVATE, the Chamber's follow-up contact only, scrubbed when
//     the registration has been dealt with.
// The hidden "website2" input is a honeypot; humans never see it.

import { useState, type FormEvent } from "react";
import { REGISTRATION_LIMITS } from "@/lib/data/scarecrows";

type Phase = "idle" | "sending" | "done";

const inputClass =
  "mt-1 block w-full rounded-xl border border-sand-deep bg-white px-3 py-2 text-ink";

export function ScarecrowRegister() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "sending") return;
    setError("");

    const form = event.currentTarget;
    const value = (name: string) =>
      ((form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "").trim();

    // "47.7981, -122.4960" as a phone or Google Maps gives it. Checked here
    // only to catch a typo before sending — the route is the real gate.
    let lat: number | undefined;
    let lng: number | undefined;
    const coords = value("coords");
    if (coords) {
      const parts = coords.split(",").map((p) => Number(p.trim()));
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
        setError("Coordinates should look like 47.7981, -122.4960 — or leave them blank.");
        return;
      }
      [lat, lng] = parts;
    }

    setPhase("sending");
    try {
      const res = await fetch("/api/scarecrow/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: value("title"),
          creator: value("creator"),
          notes: value("notes"),
          ...(lat !== undefined ? { lat, lng } : {}),
          submitterName: value("submitterName"),
          contact: value("contact"),
          website2: value("website2"),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "That didn't go through. Please try again.");
        setPhase("idle");
        return;
      }
      setPhase("done");
    } catch {
      setError("No connection — your registration was not sent.");
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <div className="rounded-xl border border-seaglass bg-seaglass/10 p-4" role="status">
        <p className="font-semibold text-sound-deep">Thanks — your scarecrow is in the queue.</p>
        <p className="mt-1 text-sm text-ink-soft">
          The Chamber checks every entry before it goes on the trail, and it appears on this page
          once approved. We&apos;ll only use your contact if something needs clarifying.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset className="rounded-xl border border-sand-deep p-4">
        <legend className="px-1 text-sm font-semibold text-sound-deep">Your scarecrow</legend>
        <p className="mb-3 text-xs text-ink-soft">Shown on this page once the Chamber approves it.</p>

        <label className="block text-sm font-semibold text-ink" htmlFor="register-title">
          Scarecrow&apos;s name
        </label>
        <input
          id="register-title"
          name="title"
          required
          maxLength={REGISTRATION_LIMITS.title}
          placeholder="Farmer Fergus"
          className={inputClass}
        />

        <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="register-creator">
          Business or maker
        </label>
        <input
          id="register-creator"
          name="creator"
          required
          maxLength={REGISTRATION_LIMITS.creator}
          placeholder="Kingston Cooperative Preschool"
          className={inputClass}
        />

        <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="register-notes">
          Where to find it
        </label>
        <textarea
          id="register-notes"
          name="notes"
          required
          rows={2}
          maxLength={REGISTRATION_LIMITS.notes}
          placeholder="11225 NE State Hwy 104 — in the front window"
          className={inputClass}
        />

        <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="register-coords">
          Map coordinates (optional)
        </label>
        <input
          id="register-coords"
          name="coords"
          inputMode="decimal"
          placeholder="47.7981, -122.4960"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-ink-soft">
          Long-press the spot in Google Maps to copy them. Leave blank and the Chamber will put the
          pin in place.
        </p>
      </fieldset>

      {/* Honeypot — visually hidden, never announced; humans skip it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="register-website2">Website</label>
        <input id="register-website2" name="website2" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="rounded-xl border border-sand-deep p-4">
        <legend className="px-1 text-sm font-semibold text-sound-deep">About you</legend>
        <p className="mb-3 text-xs text-ink-soft">
          For the Chamber only, in case they need to ask about your entry. Never shown on the page,
          and removed once your registration has been dealt with.
        </p>

        <label className="block text-sm font-semibold text-ink" htmlFor="register-name">
          Your name
        </label>
        <input
          id="register-name"
          name="submitterName"
          required
          autoComplete="name"
          maxLength={REGISTRATION_LIMITS.submitterName}
          className={inputClass}
        />

        <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="register-contact">
          Email or phone
        </label>
        <input
          id="register-contact"
          name="contact"
          required
          maxLength={REGISTRATION_LIMITS.contact}
          className={inputClass}
        />
      </fieldset>

      {error ? (
        <p className="text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={phase === "sending"}
          className="inline-flex min-h-[44px] items-center rounded-full bg-sound px-5 py-2.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
        >
          {phase === "sending" ? "Sending…" : "Register my scarecrow"}
        </button>
      </div>
    </form>
  );
}
