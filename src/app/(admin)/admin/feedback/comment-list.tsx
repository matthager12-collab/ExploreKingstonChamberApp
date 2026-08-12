"use client";

// The comment list on /admin/feedback, with per-row deletion.
//
// The delete button is not a convenience — it is the mechanism behind the
// published promise in the privacy notice ("you can have it removed sooner").
// A visitor who asks quotes the wording they wrote; the admin finds it here and
// removes it. There is no by-identifier lookup that could do this for them.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui";
import { FEEDBACK_MAX_RATING, REDACTED_PATH, type FeedbackResponse } from "@/lib/types";

export interface CommentRow {
  id: number;
  response: FeedbackResponse;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true" className="text-coral">
        {"★".repeat(rating)}
      </span>
      <span aria-hidden="true" className="text-sand">
        {"★".repeat(Math.max(0, FEEDBACK_MAX_RATING - rating))}
      </span>
      <span className="sr-only">
        {rating} of {FEEDBACK_MAX_RATING} stars
      </span>
    </span>
  );
}

function PathCell({ path }: { path: string }) {
  if (path === REDACTED_PATH || !path.startsWith("/")) {
    return <span className="text-ink-soft italic">{path}</span>;
  }
  return (
    <a href={path} className="font-medium break-all text-tide-deep underline">
      {path}
    </a>
  );
}

export function CommentList({ rows }: { rows: CommentRow[] }) {
  const router = useRouter();
  // Keyed by id: "which row is mid-delete" has to be per-row, or clicking one
  // delete button disables every button on the page.
  const [busy, setBusy] = useState<number | null>(null);
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function remove(id: number) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setError("Could not delete that comment — try again.");
        setBusy(null);
        return;
      }
      // Hide it immediately, then refresh so the counts above the list follow.
      setGone((g) => new Set(g).add(id));
      setConfirming(null);
      router.refresh();
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(null);
    }
  }

  const visible = rows.filter((r) => !gone.has(r.id));

  if (visible.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        {rows.length === 0
          ? "No written comments yet — only ratings."
          : "All the comments on this page have been deleted."}
      </p>
    );
  }

  return (
    <>
      {error && (
        <p className="mb-3 text-sm font-medium text-coral-deep" role="alert">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {visible.map((row) => (
          <li key={row.id}>
            <Card>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <Stars rating={row.response.rating} />
                <span className="flex flex-wrap items-baseline gap-2 text-xs text-ink-soft">
                  <PathCell path={row.response.path} />
                  <span>
                    {new Date(row.response.submittedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </span>
              </div>
              {/* whitespace-pre-line keeps the visitor's line breaks;
                  break-words stops an unbroken 2,000-character string from
                  blowing out the page width. */}
              <p className="whitespace-pre-line break-words text-ink">{row.response.comment}</p>

              <div className="mt-3 flex items-center gap-3">
                {confirming === row.id ? (
                  <>
                    {/* Deletion is permanent and this is someone's words, so it
                        takes two clicks. The confirm step is inline rather than
                        a window.confirm() so it is reachable by keyboard and
                        announced like the rest of the page. */}
                    <span className="text-xs text-ink" role="status">
                      Delete permanently?
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      disabled={busy === row.id}
                      className="min-h-11 rounded-full bg-coral-deep px-4 py-1 text-xs font-semibold text-white hover:bg-coral disabled:opacity-50"
                    >
                      {busy === row.id ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="min-h-11 px-2 text-xs font-medium text-tide-deep underline"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(row.id)}
                    className="min-h-11 text-xs font-medium text-tide-deep underline hover:text-sound"
                  >
                    Delete this comment
                  </button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
