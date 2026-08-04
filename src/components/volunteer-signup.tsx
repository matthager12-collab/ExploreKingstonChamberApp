"use client";

// E20 — the inline "I can help" form on each /give shift card (charter
// step 7). No account, ever: name + one contact field, and the submit is
// safe to tap on a dying connection.
//
// OFFLINE RULE (E13 contract, exactly): the FIRST attempt is our own fetch
// with a fresh idempotency key in the X-Idempotency-Key header — this
// component must tell 200 from 409-full, which submitOrQueue cannot. Only
// when that fetch THROWS (transport failure — any HTTP response means don't
// queue) does the identical request enter the outbox via enqueueRequest with
// THE SAME KEY, so a first attempt that died mid-response can never become a
// duplicate signup on replay.

import { useState, type FormEvent } from "react";

import { enqueueRequest } from "@/lib/outbox";

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50";

type Phase =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; message: string }
  | { kind: "queued" }
  | { kind: "full"; spotsLeft: number }
  | { kind: "error"; message: string };

export function VolunteerSignup({
  shiftId,
  fallbackHref,
}: {
  shiftId: string;
  /** The pre-E20 mailto CTA — kept as the honest path when a shift fills. */
  fallbackHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  function submit(e: FormEvent) {
    e.preventDefault();
    setPhase({ kind: "busy" });
    const payload = { shiftId, name, contact };
    const key = crypto.randomUUID();
    void (async () => {
      let res: Response;
      try {
        res = await fetch("/api/volunteer/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Idempotency-Key": key },
          body: JSON.stringify(payload),
        });
      } catch {
        // Transport failure — genuinely offline. Queue the IDENTICAL request
        // with the SAME key; the outbox replays it when the network returns.
        await enqueueRequest("/api/volunteer/signup", payload, key);
        setPhase({ kind: "queued" });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        spotsLeft?: number;
      };
      if (res.status === 409 && data.reason === "full") {
        setPhase({ kind: "full", spotsLeft: data.spotsLeft ?? 0 });
        return;
      }
      if (!res.ok || !data.ok) {
        setPhase({
          kind: "error",
          message: data.error ?? "Something went wrong — try again.",
        });
        return;
      }
      setPhase({
        kind: "done",
        message: contact.includes("@")
          ? "You're signed up — details are in your email."
          : "You're signed up. (Phone signups don't get automated reminders — jot the date down.)",
      });
    })();
  }

  if (phase.kind === "done" || phase.kind === "queued") {
    return (
      <p role="status" className="mt-3 text-sm font-medium text-fern">
        {phase.kind === "done"
          ? phase.message
          : "Saved — this will send as soon as you're back online."}
      </p>
    );
  }

  if (phase.kind === "full") {
    return (
      <p role="status" className="mt-3 text-sm text-ink">
        This shift just filled up.{" "}
        <a href={fallbackHref} className="font-medium text-tide-deep underline underline-offset-2">
          Email the organizer
        </a>{" "}
        to be a backup.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
          I can help
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3" data-testid="volunteer-signup-form">
      <label className="block text-sm font-medium text-ink">
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          autoComplete="name"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        Email or phone
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
          maxLength={200}
          autoComplete="email"
          className={inputClass}
        />
      </label>
      <p className="text-xs text-ink-soft">
        That&apos;s all we ask — no account, no password. Email signups get a
        reminder before the shift; we keep your contact only until 45 days after
        it.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={phase.kind === "busy"} className={buttonClass}>
          {phase.kind === "busy" ? "Signing up…" : "Sign me up"}
        </button>
        {phase.kind === "error" && (
          <p role="status" className="text-sm font-medium text-coral-deep">
            {phase.message}
          </p>
        )}
      </div>
    </form>
  );
}
