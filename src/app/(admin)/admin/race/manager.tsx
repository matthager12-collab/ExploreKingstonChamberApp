"use client";

// Client half of /admin/race: Sync now, counts, the roster with check-in,
// and the race-day volunteer link. Plain fetch + local state, like the other
// admin managers. Authorization is entirely server-side — this talks only to
// /api/admin/race/* (admin-gated). After every write the page is refreshed
// so the server-rendered rows stay the source of truth.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge, Callout, Card, Section } from "@/components/ui";

export interface RosterRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  rateTitle: string;
  shirtNote: string | null;
  waiverSigned: boolean | null;
  status: "active" | "cancelled";
  needsReviewReason: string | null;
  checkedInAt: string | null;
  registeredAt: string;
}

interface LastRun {
  startedAt: string;
  runBy: string;
  stats: Record<string, number>;
}

interface LinkState {
  version: number;
  expiresAt: string;
  revoked: boolean;
}

type Filter = "active" | "review" | "not-checked-in" | "checked-in" | "cancelled";

const buttonClass =
  "rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const quietButtonClass =
  "rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-sound-deep hover:bg-sand/40 disabled:opacity-50";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fullName(r: RosterRow): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "(name pending)";
}

const REVIEW_LABEL: Record<string, string> = {
  "no-contact-id": "Who is this ticket for?",
  "partial-refund": "Partial refund — check which ticket",
};

export function RaceManager({
  configured,
  hasWaiverQuestion,
  lastRun,
  link,
  rows,
}: {
  configured: boolean;
  hasWaiverQuestion: boolean;
  lastRun: LastRun | null;
  link: LinkState | null;
  rows: RosterRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "teal" | "coral"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);

  const active = rows.filter((r) => r.status === "active");
  const checkedIn = active.filter((r) => r.checkedInAt).length;
  const review = active.filter((r) => r.needsReviewReason).length;
  const byRate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of active) m.set(r.rateTitle, (m.get(r.rateTitle) ?? 0) + 1);
    return [...m.entries()];
  }, [active]);
  const byShirt = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of active) m.set(r.shirtNote ?? "(none)", (m.get(r.shirtNote ?? "(none)") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "cancelled") {
        if (r.status !== "cancelled") return false;
      } else if (r.status !== "active") return false;
      if (filter === "review" && !r.needsReviewReason) return false;
      if (filter === "not-checked-in" && r.checkedInAt) return false;
      if (filter === "checked-in" && !r.checkedInAt) return false;
      if (!q) return true;
      return `${fullName(r)} ${r.email ?? ""}`.toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  async function post(path: string, body?: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setMessage({ tone: "coral", text: typeof data.error === "string" ? data.error : `Request failed (${res.status}).` });
      return null;
    }
    return data;
  }

  async function syncNow() {
    setBusy("sync");
    setMessage(null);
    const data = await post("/api/admin/race/sync");
    if (data) {
      const s = data.stats as Record<string, number>;
      setMessage({ tone: "teal", text: `Synced ${s.tickets} tickets: ${s.created} new, ${s.cancelled} cancelled.` });
      router.refresh();
    }
    setBusy(null);
  }

  async function setChecked(row: RosterRow, checkedIn: boolean) {
    setBusy(row.id);
    const data = await post("/api/admin/race/checkin", { id: row.id, checkedIn });
    if (data) router.refresh();
    setBusy(null);
  }

  async function mintLink() {
    setBusy("link");
    setMessage(null);
    const data = await post("/api/admin/race/link", { action: "mint" });
    if (data && typeof data.url === "string") {
      setMintedUrl(data.url);
      router.refresh();
    }
    setBusy(null);
  }

  async function revokeLink() {
    setBusy("link");
    setMessage(null);
    const data = await post("/api/admin/race/link", { action: "revoke" });
    if (data) {
      setMintedUrl(null);
      setMessage({ tone: "teal", text: "The race-day link no longer works. Mint a new one when you need it." });
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <>
      <Section title="Sync">
        <Card>
          {!configured && (
            <div className="mb-4">
              <Callout title="Zeffy is not connected yet" tone="coral">
                Set ZEFFY_API_KEY and ZEFFY_CAMPAIGN_ID on the server (docs/runbooks/RACE-REGISTRATION.md).
                Until then this roster stays empty.
              </Callout>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className={buttonClass} disabled={!configured || busy === "sync"} onClick={syncNow}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <p className="text-sm text-ink">
              {lastRun
                ? `Last sync ${fmtWhen(lastRun.startedAt)} by ${lastRun.runBy} — ${lastRun.stats.tickets ?? 0} tickets, ${lastRun.stats.created ?? 0} new.`
                : "Never synced."}
            </p>
          </div>
          {message && (
            <div className="mt-4">
              <Callout title={message.tone === "coral" ? "Something went wrong" : "Done"} tone={message.tone}>
                {message.text}
              </Callout>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Counts">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm text-ink">Registered</p>
            <p className="text-3xl font-semibold text-sound-deep">{active.length}</p>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {byRate.map(([rate, n]) => (
                <li key={rate}>
                  {n} × {rate}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <p className="text-sm text-ink">Checked in</p>
            <p className="text-3xl font-semibold text-sound-deep">
              {checkedIn}
              <span className="text-base font-normal text-ink"> / {active.length}</span>
            </p>
            <p className="mt-2 text-sm text-ink">{review} need a look</p>
          </Card>
          <Card>
            <p className="text-sm text-ink">Shirt answers</p>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {byShirt.map(([note, n]) => (
                <li key={note}>
                  {n} × {note}
                </li>
              ))}
              {byShirt.length === 0 && <li>None yet</li>}
            </ul>
          </Card>
        </div>
      </Section>

      <Section title="Race-day link" subtitle="Volunteers open it on their phones to check runners in — no account needed.">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={buttonClass} disabled={busy === "link"} onClick={mintLink}>
              {link && !link.revoked ? "Mint a new link" : "Mint the race-day link"}
            </button>
            {link && !link.revoked && (
              <button type="button" className={quietButtonClass} disabled={busy === "link"} onClick={revokeLink}>
                Revoke
              </button>
            )}
            <p className="text-sm text-ink">
              {link && !link.revoked
                ? `Link #${link.version} works until ${fmtWhen(link.expiresAt)}.`
                : "No active link."}
            </p>
          </div>
          {mintedUrl && (
            <div className="mt-4">
              <Callout title="Copy this now — it is shown once">
                <code className="break-all text-sm">{mintedUrl}</code>
                <p className="mt-2">Anyone with the link can check runners in until it expires. Minting again replaces it.</p>
              </Callout>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Roster">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search runners"
            className="rounded-full border border-sand px-4 py-2 text-sm"
          />
          {(
            [
              ["active", "Registered"],
              ["not-checked-in", "Not checked in"],
              ["checked-in", "Checked in"],
              ["review", "Needs a look"],
              ["cancelled", "Cancelled"],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                filter === value ? "bg-sound text-white" : "border border-sand bg-white text-sound-deep"
              }`}
            >
              {label}
            </button>
          ))}
          <Link href="/race/print" className="ml-auto text-sm font-medium text-tide-deep underline">
            Printable pickup sheet
          </Link>
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-sand/40 text-left text-xs uppercase tracking-wide text-ink">
              <tr>
                <th className="px-4 py-2">Runner</th>
                <th className="px-4 py-2">Ticket</th>
                <th className="px-4 py-2">Shirt</th>
                {hasWaiverQuestion && <th className="px-4 py-2">Waiver</th>}
                <th className="px-4 py-2">Registered</th>
                <th className="px-4 py-2">Checked in</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-sand">
                  <td className="px-4 py-2">
                    <p className="font-medium text-sound-deep">{fullName(r)}</p>
                    <p className="text-xs text-ink">{r.email ?? ""}</p>
                    {r.needsReviewReason && (
                      <p className="mt-1">
                        <Badge tone="coral">{REVIEW_LABEL[r.needsReviewReason] ?? r.needsReviewReason}</Badge>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink">{r.rateTitle}</td>
                  <td className="px-4 py-2 text-ink">{r.shirtNote ?? "—"}</td>
                  {hasWaiverQuestion && (
                    <td className="px-4 py-2">
                      {r.waiverSigned ? <Badge tone="green">Signed</Badge> : <Badge tone="coral">Missing</Badge>}
                    </td>
                  )}
                  <td className="px-4 py-2 text-ink">{fmtWhen(r.registeredAt)}</td>
                  <td className="px-4 py-2">
                    {r.status === "cancelled" ? (
                      <Badge tone="sand">Cancelled</Badge>
                    ) : (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={r.checkedInAt !== null}
                          disabled={busy === r.id}
                          onChange={(e) => setChecked(r, e.target.checked)}
                          aria-label={`Checked in: ${fullName(r)}`}
                        />
                        <span className="text-xs text-ink">{r.checkedInAt ? fmtWhen(r.checkedInAt) : ""}</span>
                      </label>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-ink" colSpan={hasWaiverQuestion ? 6 : 5}>
                    Nobody matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </Section>
    </>
  );
}
