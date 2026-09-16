"use client";

// Scarecrow Crawl — pick a favourite, optionally attach a photo, share the page.
//
// The vote is one POST to /api/scarecrow/vote. Nothing identifies the voter:
// no account, no cookie, no location. A repeat vote is suppressed HERE, in
// localStorage, because the server would need an identifier to catch it and
// the whole feature refuses to hold one — the same trade the "I'm going"
// button makes, and the reason the count is published as an interest signal.
//
// Sharing uses the device's own share sheet (navigator.share). That is the
// only route to Instagram and TikTok, which have no share URL to link to; a
// desktop browser without it falls back to copying the link.

import { useState, useSyncExternalStore } from "react";
import type { CrawlPhase } from "@/lib/data/scarecrows";

/** Serializable scarecrow the server page maps into props. */
export interface VotableScarecrow {
  id: string;
  title: string;
  /** The Chamber's own line about it — business, address, whatever they typed. */
  notes?: string;
}

const VOTED_KEY = "scarecrow-crawl-2026-voted";

type Status = "idle" | "sending" | "done" | "error";
type ShareState = "idle" | "copied" | "failed";

export function ScarecrowVote({
  scarecrows,
  phase,
}: {
  scarecrows: VotableScarecrow[];
  phase: CrawlPhase;
}) {
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [share, setShare] = useState<ShareState>("idle");

  // Whether this device has voted before, read from localStorage AFTER
  // hydration: the page is ISR, so the server's markup has to be the same for
  // everyone. useSyncExternalStore is how React reads client-only state
  // without a hydration mismatch (and without setting state in an effect).
  // A blocked or private store reads as "not voted" — the vote still works,
  // we just cannot remember it, and a possible second vote beats a dead page.
  const alreadyVoted = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return window.localStorage.getItem(VOTED_KEY) !== null;
      } catch {
        return false;
      }
    },
    () => false,
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || status === "sending") return;
    setStatus("sending");
    setError("");

    const form = new FormData(event.currentTarget);
    form.set("scarecrowId", selected);
    try {
      const res = await fetch("/api/scarecrow/vote", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Your vote did not go through. Try again in a moment.");
        setStatus("error");
        return;
      }
      try {
        window.localStorage.setItem(VOTED_KEY, selected);
      } catch {
        // See above — an unrecordable vote is still a cast vote.
      }
      setStatus("done");
    } catch {
      setError("No connection. Your vote did not send.");
      setStatus("error");
    }
  }

  async function shareCrawl() {
    const url = window.location.href;
    const text = "Vote for your favourite scarecrow in Kingston 🎃";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Kingston Scarecrow Crawl", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShare("copied");
    } catch {
      // A cancelled share sheet lands here too — say nothing rather than
      // report a failure the visitor caused on purpose.
      setShare("failed");
    }
  }

  const shareButton = (
    <div className="mt-4">
      <button
        type="button"
        onClick={shareCrawl}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-sand bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-sand/30"
      >
        <span aria-hidden="true">📣</span>
        Share the crawl
      </button>
      <p className="mt-2 text-xs text-ink-soft" aria-live="polite">
        {share === "copied"
          ? "Link copied — paste it into Facebook, Instagram or TikTok."
          : "Tag @explorekingstonwa in your own photo to be in for the prize."}
      </p>
    </div>
  );

  if (phase !== "open") {
    return (
      <div className="rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
        <p className="text-ink">
          {phase === "before"
            ? "Voting opens on Saturday 17 October. The scarecrows are on the map below."
            : "Voting closed at 5pm on Saturday 31 October. Thanks for taking part!"}
        </p>
        {shareButton}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      {status === "done" || alreadyVoted ? (
        <>
          <p className="text-ink" aria-live="polite">
            {status === "done"
              ? "Thanks — your vote is in. Results go up after voting closes on 31 October."
              : "You have already voted from this device. Results go up after 31 October."}
          </p>
          {shareButton}
        </>
      ) : (
        <form onSubmit={submit}>
          <fieldset className="border-0 p-0">
            <legend className="mb-3 text-base font-semibold text-ink">
              Vote for your favourite
            </legend>
            <div className="space-y-2">
              {scarecrows.map((s) => (
                <label key={s.id} className="flex min-h-[44px] items-center gap-3 text-ink">
                  <input
                    type="radio"
                    name="favourite"
                    value={s.id}
                    checked={selected === s.id}
                    onChange={() => setSelected(s.id)}
                    className="h-5 w-5"
                  />
                  <span>
                    <span className="font-semibold">{s.title}</span>
                    {s.notes ? ` — ${s.notes}` : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <label className="block text-sm font-semibold text-ink" htmlFor="scarecrow-photo">
              Add a photo (optional)
            </label>
            <input
              id="scarecrow-photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="mt-2 block w-full text-sm text-ink"
            />
            <p className="mt-2 text-xs text-ink-soft">
              Photos go to the Chamber only — they are not published here, and the location
              information phones bury in a photo is removed before it is stored.
            </p>
          </div>

          <button
            type="submit"
            disabled={!selected || status === "sending"}
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-sound px-5 py-2.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Cast my vote"}
          </button>

          {status === "error" ? (
            <p className="mt-3 text-sm text-ink" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
