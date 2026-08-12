"use client";

import { useState } from "react";
import type { Restaurant } from "@/lib/types";

/* Save plumbing shared by the three business-listing tabs.
 *
 * Lifted verbatim out of the old 797-line editor.tsx, which held Listing
 * details, Hours and Events in one file with THREE independent useSave()
 * instances — the seams were already drawn, this just makes them file
 * boundaries so each tab can be its own route.
 *
 * Behaviour is unchanged: same endpoint, same pending semantics, same copy. */

/** Member saves hold for Chamber review (E08); the API says so with
 *  `pending: true` and the success copy must not promise instant publish. */
export const PENDING_TEXT = "Submitted — goes live after Chamber review.";

export type SaveMessageState = { ok: boolean; text: string } | null;

export function useSave() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SaveMessageState>(null);

  /** run() returns true when the API held the write for review. */
  async function save(
    run: () => Promise<boolean | void>,
    successText: string,
    pendingText: string = PENDING_TEXT,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const pending = await run();
      setMessage({ ok: true, text: pending === true ? pendingText : successText });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Something went wrong — try again",
      });
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, save };
}

export function SaveMessage({ message }: { message: SaveMessageState }) {
  if (!message) return null;
  return (
    <p
      // Failure is --color-danger, not coral. Coral is the CTA colour on this
      // very page ("Save details"), so using it for failure too meant one hue
      // saying both "press this" and "that went wrong".
      className={`text-sm font-semibold ${message.ok ? "text-success-deep" : "text-danger"}`}
      role="status"
    >
      {message.text}
    </p>
  );
}

export async function putListing(
  payload: Record<string, unknown>,
): Promise<{ listing: Restaurant; pending: boolean }> {
  const res = await fetch("/api/portal/listing", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    listing?: Restaurant;
    pending?: boolean;
  };
  if (!res.ok || !data.listing) throw new Error(data.error ?? "Save failed");
  return { listing: data.listing, pending: Boolean(data.pending) };
}
