"use client";

// The owner's quarterly "is this series still right?" list.
//
// Small and interactive rather than a page of its own: the whole ask is one
// question per repeating event, and burying it behind a link is how it gets
// ignored until the 14-day deadline hands it to the Chamber. Confirming
// removes the row in place — no navigation, no reload.
//
// Deliberately NOT a "still right / not right" pair. "Not right" is not one
// action, it is any of a dozen edits, so that path is a link into the event's
// own editor; only the no-change answer is a button, because only that one is
// genuinely a single click.

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";

export interface SeriesCheck {
  /** Worklist item id — what the verify route resolves. */
  itemId: string;
  eventId: string;
  title: string;
  /** Plain-language repeat summary, e.g. "Every week on Saturday". */
  repeat: string;
  /** Listing id to deep-link the editor, when the event has one. */
  listingId?: string;
  /** ISO deadline; past it the task returns to the Chamber. */
  dueAt: string | null;
}

function daysLeft(dueAt: string | null): number | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

export function SeriesChecks({ checks }: { checks: SeriesCheck[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = checks.filter((c) => !done.has(c.itemId));
  if (open.length === 0) return null;

  async function confirm(itemId: string) {
    setBusy(itemId);
    setError(null);
    try {
      const res = await fetch("/api/portal/events/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Could not save that — try again.");
        return;
      }
      setDone((prev) => new Set(prev).add(itemId));
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-coral/40 bg-coral/5">
      <p className="font-display text-lg font-semibold text-sound-deep">
        {open.length === 1
          ? "One repeating event needs a quick check"
          : `${open.length} repeating events need a quick check`}
      </p>
      <p className="mt-1 text-sm text-ink">
        These repeat on the town calendar, so they keep showing up until someone
        says otherwise. Confirm each one is still running as listed.
      </p>
      {error && (
        <p className="mt-3 rounded-lg border border-coral/40 bg-white px-3 py-2 text-sm text-coral-deep" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-4 grid gap-3">
        {open.map((check) => {
          const left = daysLeft(check.dueAt);
          return (
            <li
              key={check.itemId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-white p-3"
            >
              <span className="min-w-0">
                <span className="block font-medium text-sound-deep">{check.title}</span>
                <span className="block text-sm text-ink-soft">
                  {check.repeat}
                  {left !== null && (
                    <>
                      {" · "}
                      {left <= 0
                        ? "due now"
                        : left === 1
                          ? "1 day left"
                          : `${left} days left`}
                    </>
                  )}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-3">
                {check.listingId && (
                  <Link
                    href={`/portal/business/${check.listingId}`}
                    className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                  >
                    Something changed
                  </Link>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => confirm(check.itemId)}
                  className="rounded-full bg-fern px-4 py-2 text-sm font-semibold text-white hover:ring-2 hover:ring-fern hover:ring-offset-1 disabled:cursor-default disabled:opacity-60"
                >
                  {busy === check.itemId ? "Saving…" : "Still right"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
