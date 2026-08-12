"use client";

// Directory bulk-publish control (directory-public slice): the R2 "app
// becomes the public directory" act as one reviewed click. The button first
// asks the API for a DRY RUN, shows the real counts in the confirm dialog,
// and only then runs the write pass — an admin never publishes a number they
// haven't seen. Per-listing publish decisions (courtesy members, specials)
// stay in the record editor above; this control only sweeps active members.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PublishCounts {
  published: number;
  alreadyLive: number;
  notDraft: number;
  noMemberMeta: number;
  notActiveMember: number;
}

export function DirectoryPublish() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  async function post(dryRun: boolean): Promise<{ counts: PublishCounts } | null> {
    const res = await fetch("/api/admin/directory/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      counts?: PublishCounts;
    };
    if (!res.ok || !data.counts) {
      setMessage({ ok: false, text: data.error ?? "Publish failed" });
      return null;
    }
    return { counts: data.counts };
  }

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const preview = await post(true);
      if (!preview) return;
      const c = preview.counts;
      if (c.published === 0) {
        setMessage({
          ok: true,
          text: `Nothing to publish — ${c.alreadyLive} already live, ${c.noMemberMeta} without roster data, ${c.notActiveMember} not active members.`,
        });
        return;
      }
      const confirmed = window.confirm(
        `Publish ${c.published} draft listing(s) for active members?\n\n` +
          `Skipped: ${c.alreadyLive} already live · ${c.notActiveMember} not active ` +
          `· ${c.noMemberMeta} without roster data · ${c.notDraft} in another workflow.\n\n` +
          `Published listings appear on the public directory immediately.`,
      );
      if (!confirmed) return;
      const real = await post(false);
      if (!real) return;
      setMessage({
        ok: true,
        text: `Published ${real.counts.published} listing(s). They're public now.`,
      });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
      >
        {busy ? "Working…" : "Publish active members' draft listings"}
      </button>
      {message && (
        <p
          role="status"
          className={`text-sm font-medium ${message.ok ? "text-fern" : "text-coral-deep"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
