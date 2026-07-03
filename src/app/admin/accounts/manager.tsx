"use client";

// Client half of /admin/accounts: accounts table, invite list, and the
// create-invite form. Deliberately plain (fetch + local state, no reload) in
// the same spirit as portal/forms.tsx. All authorization is server-side —
// this UI just talks to /api/portal/invites, which requires role admin.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Card, Section } from "@/components/ui";

type Role = "business" | "nonprofit" | "admin";

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  linkedIds: string[];
  createdAt: string;
}

export interface InviteRow {
  code: string;
  role: Role;
  linkedIds: string[];
  note?: string;
  createdAt: string;
  usedBy?: string;
}

export interface NameOption {
  id: string;
  name: string;
}

const roleTone = { admin: "navy", business: "teal", nonprofit: "green" } as const;
const roleLabel: Record<Role, string> = {
  admin: "Admin",
  business: "Business",
  nonprofit: "Nonprofit",
};

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable (e.g. plain-http LAN) — text is visible to select.
        }
      }}
      className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-0.5 text-xs font-semibold text-tide-deep hover:border-tide"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function AccountsManager({
  users,
  invites: initialInvites,
  restaurants,
  charities,
}: {
  users: SafeUser[];
  invites: InviteRow[];
  restaurants: NameOption[];
  charities: NameOption[];
}) {
  // ---------- shared lookups ----------

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of restaurants) m.set(r.id, r.name);
    for (const c of charities) m.set(c.id, c.name);
    return m;
  }, [restaurants, charities]);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const resolveNames = (ids: string[]) => ids.map((id) => nameById.get(id) ?? id);

  // window.location isn't available during the server render pass — fill the
  // origin in after mount so copy buttons and blurbs carry the full URL.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const joinUrl = `${origin}/portal/join`;

  // ---------- invites state ----------

  const [invites, setInvites] = useState<InviteRow[]>(() =>
    [...initialInvites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  const pending = invites.filter((i) => !i.usedBy);
  const used = invites.filter((i) => i.usedBy);

  // ---------- create-invite form state ----------

  const [role, setRole] = useState<Role>("business");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<InviteRow | null>(null);

  const options = role === "business" ? restaurants : role === "nonprofit" ? charities : [];

  function pickRole(next: Role) {
    setRole(next);
    setSelected(new Set());
    setError(null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function blurbFor(invite: InviteRow): string {
    const names = resolveNames(invite.linkedIds);
    const tail =
      names.length > 0
        ? ` — it links you to ${listNames(names)} so you can update hours, events, and listing details anytime`
        : invite.role === "admin"
          ? " — it gives you Chamber admin access"
          : "";
    return `Create your account at ${joinUrl} with code ${invite.code}${tail}.`;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const linkedIds = role === "admin" ? [] : [...selected];
    if (role !== "admin" && linkedIds.length === 0) {
      setError(
        role === "business"
          ? "Pick at least one restaurant to link this account to."
          : "Pick at least one organization to link this account to.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, linkedIds, note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; invite?: InviteRow; error?: string };
      if (!res.ok || !data.ok || !data.invite) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      const invite = data.invite;
      setInvites((prev) => [invite, ...prev]);
      setFresh(invite);
      setSelected(new Set());
      setNote("");
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  // ---------- render ----------

  return (
    <>
      <Section title="Accounts" subtitle="Everyone with a portal login and what they manage.">
        <Card>
          {users.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No accounts yet. The first admin is created at /portal/setup.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-sand text-xs font-semibold tracking-wide text-ink-soft uppercase">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Manages</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-sand last:border-b-0">
                      <td className="px-3 py-3 font-medium text-ink">{u.name}</td>
                      <td className="px-3 py-3 text-ink-soft">{u.email}</td>
                      <td className="px-3 py-3">
                        <Badge tone={roleTone[u.role]}>{roleLabel[u.role]}</Badge>
                      </td>
                      <td className="px-3 py-3 text-ink-soft">
                        {u.role === "admin"
                          ? "Everything (admin)"
                          : u.linkedIds.length > 0
                            ? resolveNames(u.linkedIds).join(", ")
                            : "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-soft">
                        {fmtDate(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section
        title="Invites"
        subtitle="Codes waiting to be redeemed at /portal/join. Used codes stay here as a record."
      >
        {invites.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">No invites yet — create one below.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((i) => (
              <Card key={i.code}>
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded-lg border border-sand bg-shell px-3 py-1 font-mono text-lg font-bold tracking-wider text-sound-deep">
                    {i.code}
                  </code>
                  <CopyButton text={i.code} label="Copy code" />
                  <Badge tone={roleTone[i.role]}>{roleLabel[i.role]}</Badge>
                  <span className="text-xs text-ink-soft">created {fmtDate(i.createdAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <span>
                    Redeem at <span className="font-medium break-all text-ink">{joinUrl}</span>
                  </span>
                  <CopyButton text={joinUrl} label="Copy link" />
                </div>
                {i.linkedIds.length > 0 && (
                  <p className="mt-1 text-sm text-ink-soft">
                    Links to:{" "}
                    <span className="font-medium text-ink">
                      {resolveNames(i.linkedIds).join(", ")}
                    </span>
                  </p>
                )}
                {i.note && <p className="mt-1 text-sm text-ink-soft italic">“{i.note}”</p>}
              </Card>
            ))}
            {used.map((i) => {
              const redeemer = i.usedBy ? userById.get(i.usedBy) : undefined;
              return (
                <Card key={i.code} className="bg-shell">
                  <div className="flex flex-wrap items-center gap-3 text-ink-soft">
                    <code className="font-mono text-sm line-through">{i.code}</code>
                    <Badge tone="sand">{roleLabel[i.role]}</Badge>
                    <span className="text-xs">
                      redeemed by{" "}
                      <span className="font-medium">
                        {redeemer ? `${redeemer.name} (${redeemer.email})` : i.usedBy}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft line-through">
                    {[
                      i.linkedIds.length > 0 ? resolveNames(i.linkedIds).join(", ") : null,
                      i.note ?? null,
                      `created ${fmtDate(i.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Create an invite"
        subtitle="Mint a code, then email it to the owner — their account links itself when they redeem it."
      >
        {fresh && (
          <Card className="mb-5 border-tide bg-tide/5">
            <p className="text-sm font-semibold tracking-wide text-tide-deep uppercase">
              Invite created — share this code
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="rounded-lg border border-sand bg-white px-4 py-2 font-mono text-2xl font-bold tracking-widest text-sound-deep">
                {fresh.code}
              </code>
              <CopyButton text={fresh.code} label="Copy code" />
              <Badge tone={roleTone[fresh.role]}>{roleLabel[fresh.role]}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <span>
                They redeem it at <span className="font-medium break-all text-ink">{joinUrl}</span>
              </span>
              <CopyButton text={joinUrl} label="Copy link" />
            </div>
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-sound-deep">Paste-ready email blurb</p>
                <CopyButton text={blurbFor(fresh)} label="Copy blurb" />
              </div>
              <p className="mt-2 rounded-lg border border-sand bg-white p-3 text-sm break-words text-ink">
                {blurbFor(fresh)}
              </p>
            </div>
          </Card>
        )}

        <Card>
          <form onSubmit={submit} className="max-w-xl space-y-4">
            <label className="block text-sm font-medium text-ink">
              Account type
              <select
                value={role}
                onChange={(e) => pickRole(e.target.value as Role)}
                className={inputClass}
              >
                <option value="business">Business — manages restaurant listings</option>
                <option value="nonprofit">Nonprofit — manages an organization</option>
                <option value="admin">Admin — full Chamber access</option>
              </select>
            </label>

            {role !== "admin" && (
              <fieldset>
                <legend className="text-sm font-medium text-ink">
                  {role === "business"
                    ? "Restaurants this account manages"
                    : "Organizations this account manages"}
                </legend>
                <div className="mt-1 grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-sand bg-white p-3 sm:grid-cols-2">
                  {options.length === 0 ? (
                    <p className="text-sm text-ink-soft">
                      Nothing to link yet — add {role === "business" ? "restaurants" : "organizations"} first.
                    </p>
                  ) : (
                    options.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={selected.has(o.id)}
                          onChange={() => toggle(o.id)}
                          className="size-4 accent-tide"
                        />
                        {o.name}
                      </label>
                    ))
                  )}
                </div>
              </fieldset>
            )}

            <label className="block text-sm font-medium text-ink">
              Note (only admins see this)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="for Maria at Sourdough Willy's"
                className={inputClass}
              />
            </label>

            {error && <p className="text-sm font-medium text-coral-deep">{error}</p>}
            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? "Creating…" : "Create invite"}
            </button>
          </form>
        </Card>
      </Section>
    </>
  );
}
