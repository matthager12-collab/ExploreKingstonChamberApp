"use client";

// E20 — the two buttons on the manage page. Tokens arrive from the server
// component (which already proved access); each POST carries the token whose
// purpose matches its action, because the API enforces exactly that.

import { useState } from "react";

const primaryClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const dangerClass =
  "rounded-full border border-coral/50 bg-white px-6 py-2.5 font-semibold text-coral-deep hover:border-coral disabled:opacity-50";

export function ManageActions({
  signupId,
  confirmToken,
  cancelToken,
}: {
  signupId: string;
  confirmToken: string;
  cancelToken: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function act(action: "confirm" | "cancel") {
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const res = await fetch("/api/volunteer/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signupId,
            action,
            token: action === "confirm" ? confirmToken : cancelToken,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          confirmed?: boolean;
        };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Something went wrong");
        setMessage({
          ok: true,
          text:
            action === "confirm"
              ? "See you there — thanks for confirming."
              : "You're off the list, and the spot just reopened for someone else. Thanks for letting us know.",
        });
      } catch (err) {
        setMessage({
          ok: false,
          text: err instanceof Error ? err.message : "Something went wrong — try again.",
        });
      } finally {
        setBusy(false);
      }
    })();
  }

  if (message?.ok) {
    return (
      <p role="status" className="text-sm font-medium text-fern">
        {message.text}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">Plans change — one tap either way.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => act("confirm")} className={primaryClass}>
          I&apos;m still coming
        </button>
        <button type="button" disabled={busy} onClick={() => act("cancel")} className={dangerClass}>
          I can&apos;t make it
        </button>
      </div>
      {message && !message.ok && (
        <p role="status" className="text-sm font-medium text-coral-deep">
          {message.text}
        </p>
      )}
    </div>
  );
}
