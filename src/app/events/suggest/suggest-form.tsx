"use client";

// E12 public suggest form (M-05-03). No account. Two contacts, kept distinct:
//   - "Public contact for questions" (required) → shown on the event so the
//     town asks the organizer, not the Chamber.
//   - the "About you" fieldset → the submitter's own name + one contact,
//     PRIVATE (Chamber-only, MHMDA data-minimized).
// Plus optional artwork/flyer uploads (images or PDF, up to 5). The hidden
// "website2" input is a honeypot; humans never see it.

import { useRef, useState, type FormEvent } from "react";

// Client-side hints only — the /api/events/suggest route is the real gate.
const MAX_FILES = 5;
const MAX_FILE_MB = 8;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,.heic,.pdf";

const inputClass =
  "w-full rounded-lg border border-sand-deep bg-white px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-soft/60 focus:border-tide focus:outline-none";
const labelClass = "block text-sm font-medium text-sound-deep";

export function SuggestEventForm() {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    setError(null);
    const incoming = Array.from(selected);
    const tooBig = incoming.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" is over ${MAX_FILE_MB} MB.`);
      return;
    }
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of incoming) {
        if (merged.length >= MAX_FILES) break;
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      return merged;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPhase("busy");
    setError(null);
    const form = e.currentTarget;
    const data = new FormData();
    for (const name of [
      "title",
      "start",
      "end",
      "venue",
      "description",
      "url",
      "eventContact",
      "submitterName",
      "contact",
      "website2",
    ]) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      data.set(name, el?.value ?? "");
    }
    for (const file of files) data.append("attachments", file);

    try {
      const res = await fetch("/api/events/suggest", { method: "POST", body: data });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Could not send the suggestion — try again.");
        setPhase("idle");
        return;
      }
      setPhase("done");
    } catch {
      setError("Could not reach the server — try again.");
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <div className="rounded-xl border border-seaglass bg-seaglass/10 p-4" role="status">
        <p className="font-semibold text-sound-deep">Thanks — it&apos;s in the queue.</p>
        <p className="mt-1 text-sm text-ink-soft">
          The Chamber reviews every suggestion before it appears on the calendar.
          We&apos;ll only use your contact if something needs clarifying.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <label className={labelClass} htmlFor="suggest-title">
          Event title *
        </label>
        <input id="suggest-title" name="title" required maxLength={200} className={inputClass} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="suggest-start">
            Starts *
          </label>
          <input
            id="suggest-start"
            name="start"
            type="datetime-local"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="suggest-end">
            Ends
          </label>
          <input id="suggest-end" name="end" type="datetime-local" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="suggest-venue">
          Venue *
        </label>
        <input
          id="suggest-venue"
          name="venue"
          required
          maxLength={200}
          placeholder="Mike Wallace Park"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="suggest-description">
          What&apos;s happening?
        </label>
        <textarea
          id="suggest-description"
          name="description"
          rows={3}
          maxLength={2000}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="suggest-url">
          Link (details / tickets)
        </label>
        <input
          id="suggest-url"
          name="url"
          type="url"
          placeholder="https://…"
          maxLength={500}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="suggest-event-contact">
          Public contact for questions *
        </label>
        <input
          id="suggest-event-contact"
          name="eventContact"
          required
          maxLength={200}
          placeholder="Jane Doe · jane@example.org · (360) 555-0100"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-ink-soft">
          Shown on the event so people ask the organizer directly. This is public.
        </p>
      </div>

      {/* Artwork / flyers */}
      <div>
        <label className={labelClass} htmlFor="suggest-files">
          Artwork or flyers
        </label>
        <input
          id="suggest-files"
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => addFiles(e.target.files)}
          disabled={files.length >= MAX_FILES}
          className="mt-1 block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-sand file:px-3 file:py-2 file:text-sm file:font-medium file:text-sound-deep hover:file:bg-sand-deep"
        />
        <p className="mt-1 text-xs text-ink-soft">
          Images or PDF, up to {MAX_FILES} files, {MAX_FILE_MB} MB each.
        </p>
        {files.length > 0 && (
          <ul className="mt-2 grid gap-1">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${f.size}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-sand/40 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate text-ink">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="shrink-0 text-xs font-medium text-coral-deep underline underline-offset-2"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Honeypot — visually hidden, never announced; humans skip it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="suggest-website2">Website</label>
        <input id="suggest-website2" name="website2" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="rounded-xl border border-sand-deep p-4">
        <legend className="px-1 text-sm font-semibold text-sound-deep">About you</legend>
        <p className="mb-3 text-xs text-ink-soft">
          Just a name and one way to reach you, for the Chamber&apos;s review — this is
          private and never shown publicly.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="suggest-name">
              Your name *
            </label>
            <input
              id="suggest-name"
              name="submitterName"
              required
              maxLength={200}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="suggest-contact">
              Your email or phone *
            </label>
            <input
              id="suggest-contact"
              name="contact"
              required
              maxLength={200}
              className={inputClass}
            />
          </div>
        </div>
      </fieldset>

      {error && (
        <p className="text-sm font-medium text-coral" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={phase === "busy"}
        className="justify-self-start rounded-lg bg-sound px-5 py-2.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-60"
      >
        {phase === "busy" ? "Sending…" : "Suggest this event"}
      </button>
    </form>
  );
}
