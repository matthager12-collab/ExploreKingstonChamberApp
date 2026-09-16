"use client";

// The rehearsal controls: force voting open or shut, and empty the tally.
//
// Both write through /api/admin/scarecrow, which re-checks the admin role —
// the console's own gate is the layout, and layouts do not cover route
// handlers.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CrawlPhase, VotingOverride } from "@/lib/data/scarecrows";

const CHOICES: { value: VotingOverride; label: string; hint: string }[] = [
  { value: "auto", label: "Follow the dates", hint: "17–31 October. What the real crawl runs on." },
  { value: "open", label: "Open now", hint: "For testing before the crawl starts." },
  { value: "closed", label: "Closed", hint: "Stops voting whatever the date says." },
];

export function VotingControls({
  voting,
  phase,
  totalVotes,
}: {
  voting: VotingOverride;
  phase: CrawlPhase;
  totalVotes: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function choose(next: VotingOverride) {
    if (next === voting || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/admin/scarecrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voting: next }),
      });
      if (!res.ok) {
        setError("That could not be saved.");
        return;
      }
      setNote("Saved. The public page follows within a minute.");
      router.refresh();
    } catch {
      setError("No connection — nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  async function clearVotes() {
    if (busy) return;
    const warning =
      totalVotes === 1
        ? "Delete the 1 vote cast so far, and its photo? This cannot be undone."
        : `Delete all ${totalVotes} votes cast so far, and their photos? This cannot be undone.`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/admin/scarecrow", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { deleted?: number };
      if (!res.ok) {
        setError("The votes could not be cleared.");
        return;
      }
      setNote(`Cleared ${body.deleted ?? 0} vote(s). The tally starts again from zero.`);
      router.refresh();
    } catch {
      setError("No connection — nothing was cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-sand bg-white p-5">
      <fieldset className="border-0 p-0">
        <legend className="mb-3 text-base font-semibold text-ink">Voting</legend>
        <div className="space-y-2">
          {CHOICES.map((choice) => (
            <label key={choice.value} className="flex min-h-[44px] items-start gap-3 text-ink">
              <input
                type="radio"
                name="voting"
                value={choice.value}
                checked={voting === choice.value}
                onChange={() => choose(choice.value)}
                disabled={busy}
                className="mt-0.5 h-5 w-5"
              />
              <span>
                <span className="font-semibold">{choice.label}</span>
                <span className="block text-sm text-ink-soft">{choice.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-3 text-sm text-ink-soft">
        Right now the page is{" "}
        <span className="font-semibold text-ink">
          {phase === "open"
            ? "taking votes"
            : phase === "before"
              ? "waiting for the crawl to start"
              : "showing results, voting shut"}
        </span>
        .
      </p>

      <div className="mt-4 border-t border-sand pt-4">
        <button
          type="button"
          onClick={clearVotes}
          disabled={busy || totalVotes === 0}
          className="inline-flex min-h-[44px] items-center rounded-full border border-sand px-5 py-2.5 text-sm font-semibold text-ink hover:bg-sand/30 disabled:opacity-50"
        >
          {totalVotes === 0 ? "No votes to clear" : "Clear all votes"}
        </button>
        <p className="mt-2 text-xs text-ink-soft">
          Deletes every vote and every photo, for starting clean after a rehearsal. It cannot be
          undone, and it is recorded in the change history.
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="mt-3 text-sm text-ink-soft" aria-live="polite">
          {note}
        </p>
      ) : null}
    </div>
  );
}
