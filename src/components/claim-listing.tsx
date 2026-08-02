"use client";

// E17 claim-listing disclosure (M-10-03 / FR-A96): a quiet "Own this
// business? Claim this listing" link on the /eat and /stay cards that expands
// into a small inline form — your name, a way to reach you (phone-first: the
// Chamber verifies by calling), and an optional note. POSTs to /api/claim.
//
// A request grants NOTHING: no session, no account, no edit rights — the
// server opens a Chamber worklist item and the Chamber verifies out-of-band.
// Repeat requests for the same listing merge into one queue entry server-side,
// first-writer-wins: a later request bumps a counter and cannot overwrite the
// first requester's details.
//
// All public wording resolves through the copy registry (useCopy — E07 rule);
// the only inline strings are admin-authored API error messages passed through.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCopy } from "@/lib/copy-context";

export function ClaimListing({
  store,
  id,
  subject,
}: {
  /** Claimable content store: "restaurants" | "lodging" | "charities" | "directory". */
  store: string;
  /** Record id within the store. */
  id: string;
  /** Listing name — disambiguates the identical disclosure buttons for
   *  assistive tech (many cards render this component on one page). */
  subject?: string;
}) {
  const [open, setOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const formId = useId();
  const nameId = useId();
  const contactId = useId();
  const contactHintId = useId();
  const messageId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);

  const disclosureLabel = useCopy("claim.disclosure.label");
  const intro = useCopy("claim.form.intro");
  const nameLabel = useCopy("claim.form.name.label");
  const contactLabel = useCopy("claim.form.contact.label");
  const contactHint = useCopy("claim.form.contact.hint");
  const messageLabel = useCopy("claim.form.message.label");
  const optionalMark = useCopy("claim.form.optional");
  const submitLabel = useCopy("claim.form.submit");
  const sendingLabel = useCopy("claim.form.sending");
  const cancelLabel = useCopy("claim.form.cancel");
  const successText = useCopy("claim.form.success");
  const genericError = useCopy("claim.form.error");

  // Focus management, deliberately limited to TWO moments:
  //
  //  1. the disclosure EXPANDING — focus moves into the form so a keyboard or
  //     screen-reader user lands on the first field instead of having to hunt
  //     for content that appeared below the button they just pressed;
  //  2. success — focus moves to the confirmation, so the outcome is never
  //     silent (the form itself is gone by then).
  //
  // Nothing else may move focus. This effect used to depend on [open, phase],
  // and `phase` cycles idle → busy → idle on every submit: it re-fired
  // mid-request and again when an error rendered, yanking the caret out of
  // the submit button the user had just pressed and back to the name field —
  // right when they needed to read the error. Depending on [open] alone means
  // it runs only when the disclosure actually toggles (closing is a no-op:
  // the form has unmounted, so the ref is null). The error is announced
  // instead of grabbed: it renders into a role="alert" live region below.
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (phase === "done") doneRef.current?.focus();
  }, [phase]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPhase("busy");
    setError(null);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          id,
          contactName,
          contact,
          ...(message.trim() ? { message } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? genericError);
        setPhase("idle");
        return;
      }
      setPhase("done");
    } catch {
      setError(genericError);
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <p
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="mt-2 text-xs font-medium text-fern"
      >
        {successText}
      </p>
    );
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-label={subject ? `${disclosureLabel} — ${subject}` : undefined}
        className="text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        {disclosureLabel}
      </button>
      {open && (
        <form
          id={formId}
          onSubmit={submit}
          className="mt-3 space-y-2 rounded-lg border border-sand bg-white/60 p-3"
        >
          <p className="text-xs text-ink-soft">{intro}</p>
          <label htmlFor={nameId} className="block text-xs font-medium text-ink">
            {nameLabel}
            <input
              ref={nameRef}
              id={nameId}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
              className="mt-1 block w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label htmlFor={contactId} className="block text-xs font-medium text-ink">
            {contactLabel}
            <input
              id={contactId}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              maxLength={200}
              autoComplete="tel"
              aria-describedby={contactHintId}
              className="mt-1 block w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <p id={contactHintId} className="text-xs font-normal text-ink-soft">
            {contactHint}
          </p>
          <label htmlFor={messageId} className="block text-xs font-medium text-ink">
            {messageLabel} <span className="font-normal text-ink-soft">{optionalMark}</span>
            <textarea
              id={messageId}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={1000}
              className="mt-1 block w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-sm"
            />
          </label>
          {error && (
            <p className="text-xs font-medium text-coral-deep" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={phase === "busy" || !contactName.trim() || !contact.trim()}
              className="rounded-full bg-sound px-4 py-1.5 text-xs font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
            >
              {phase === "busy" ? sendingLabel : submitLabel}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-sand bg-white px-4 py-1.5 text-xs font-medium text-ink hover:border-tide"
            >
              {cancelLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
