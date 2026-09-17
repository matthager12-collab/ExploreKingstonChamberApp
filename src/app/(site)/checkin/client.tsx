"use client";

// Phone-first check-in list. Optimistic: the row flips as soon as it is
// tapped and flips back with a message if the server says no. Search is
// client-side over the whole active roster (a few hundred rows at most), so
// a flaky venue connection only matters at tap time.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge, Card, Section } from "@/components/ui";

export interface CheckinRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  rateTitle: string;
  shirtNote: string | null;
  waiverSigned: boolean | null;
  needsReviewReason: string | null;
  checkedInAt: string | null;
}

const REVIEW_LABEL: Record<string, string> = {
  "no-contact-id": "Ask who this ticket is for",
  "partial-refund": "Partial refund — check with the Chamber",
};

function fullName(r: CheckinRow): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "(name pending)";
}

export function CheckinClient({ rows: initial, hasWaiverQuestion }: { rows: CheckinRow[]; hasWaiverQuestion: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const checkedIn = rows.filter((r) => r.checkedInAt).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => fullName(r).toLowerCase().includes(q));
  }, [rows, query]);

  async function set(row: CheckinRow, checkedIn: boolean) {
    setBusy(row.id);
    setMessage(null);
    const before = row.checkedInAt;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, checkedInAt: checkedIn ? new Date().toISOString() : null } : r)));
    try {
      const res = await fetch("/api/checkin/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, checkedIn }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, checkedInAt: before } : r)));
        setMessage(data.error ?? `Could not save (${res.status}). Try again.`);
        if (res.status === 401) router.refresh();
      }
    } catch {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, checkedInAt: before } : r)));
      setMessage("No connection — that tap was not saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Runner's name"
          aria-label="Search runners by name"
          className="min-h-11 flex-1 rounded-full border border-sand px-4 text-base"
        />
        <p className="text-sm text-ink">
          {checkedIn} / {rows.length} checked in
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="min-h-11 rounded-full border border-sand bg-white px-4 text-sm font-semibold text-sound-deep"
        >
          Refresh list
        </button>
      </div>
      {message && (
        <p role="alert" className="mb-4 rounded-xl border border-coral/40 bg-coral/10 px-4 py-2 text-sm text-coral-deep">
          {message}
        </p>
      )}
      <ul className="space-y-2">
        {visible.map((r) => {
          const done = r.checkedInAt !== null;
          return (
            <li key={r.id}>
              <Card className={done ? "bg-fern/5" : ""}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-sound-deep">{fullName(r)}</p>
                    <p className="text-sm text-ink">
                      {r.rateTitle}
                      {r.shirtNote ? ` · shirt: ${r.shirtNote}` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {r.needsReviewReason && (
                        <Badge tone="coral">{REVIEW_LABEL[r.needsReviewReason] ?? r.needsReviewReason}</Badge>
                      )}
                      {hasWaiverQuestion && !r.waiverSigned && <Badge tone="coral">Waiver missing</Badge>}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => set(r, !done)}
                    aria-pressed={done}
                    className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-semibold ${
                      done ? "border border-fern text-fern" : "bg-sound text-white hover:bg-sound-deep"
                    } disabled:opacity-50`}
                  >
                    {done ? "Checked in ✓" : "Check in"}
                  </button>
                </div>
              </Card>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="rounded-2xl border border-sand bg-white p-5 text-ink">
            Nobody by that name. Check the spelling, or ask the Chamber — they can register a walk-up on Zeffy.
          </li>
        )}
      </ul>
    </Section>
  );
}
