"use client";

// Client half of /admin/accounts: the accounts table (role, status, last login,
// and the lifecycle actions), the invite list, and the create-invite form.
// Deliberately plain (fetch + local state, no reload) in the same spirit as
// portal/forms.tsx. All authorization is server-side — this UI talks to
// /api/portal/invites and /api/portal/users, both of which require role admin.
//
// The role vocabulary comes from @/lib/auth/roles, which imports NOTHING.
// Importing it from @/lib/auth or @/lib/db/schema instead would drag drizzle-orm
// into the browser bundle, and re-declaring it here (what v1 did) is how the
// five roles drift out of sync with the five the database will accept.

import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ORG_KINDS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_TONES,
  isOrgRole,
  type OrgKind,
  type Role,
} from "@/lib/auth/roles";
import { Badge, Card, Section } from "@/components/ui";

/** Mirrors PublicUser (src/lib/auth/identity.ts) with Dates already serialized.
 *  There is no passwordHash field to forget to strip — the server builds this
 *  payload with toPublicUser(), which cannot carry one. */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Copied from identity.ts rather than imported: that module reaches the DB, so
 *  a value import would pull the server into this bundle. */
export type InviteState = "active" | "used" | "revoked" | "expired";

export interface InviteRow {
  code: string;
  role: Role;
  orgId: string | null;
  newOrgName: string | null;
  newOrgKind: OrgKind | null;
  linkedIds: string[];
  email: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedBy: string | null;
  usedAt: string | null;
  state: InviteState;
}

export interface NameOption {
  id: string;
  name: string;
}

export interface OrgOption extends NameOption {
  kind: OrgKind;
}

const inviteStateTone = {
  active: "green",
  used: "sand",
  // Revoked and expired share a tone on purpose: both answer "why won't this
  // code work?", which is the only question this badge is here to answer.
  revoked: "coral",
  expired: "coral",
} as const satisfies Record<InviteState, "navy" | "teal" | "coral" | "green" | "sand">;

const inviteStateLabel: Record<InviteState, string> = {
  active: "Active",
  used: "Redeemed",
  revoked: "Revoked",
  expired: "Expired",
};

const kindLabel: Record<OrgKind, string> = {
  business: "Business",
  nonprofit: "Nonprofit",
};

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const ghostButtonClass =
  "rounded-full border border-sand bg-white px-5 py-2 text-sm font-semibold text-tide-deep hover:border-tide disabled:opacity-50";
const rowButtonClass =
  "rounded-full border border-sand bg-white px-3 py-1 text-xs font-semibold whitespace-nowrap text-tide-deep hover:border-tide disabled:opacity-50";
const rowDangerClass =
  "rounded-full border border-coral bg-coral/10 px-3 py-1 text-xs font-semibold whitespace-nowrap text-coral-deep hover:bg-coral/20 disabled:opacity-50";

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

/**
 * Two-step control for actions that cannot be undone from this screen. The
 * first click only arms it, so a mis-click in a dense row of buttons cannot
 * delete an account or burn an invite.
 *
 * `description` becomes the accessible name — "Delete" alone is ambiguous when
 * every row has one.
 */
function ConfirmButton({
  label,
  confirmLabel,
  description,
  onConfirm,
  disabled,
  danger = true,
}: {
  label: string;
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        aria-label={description}
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={danger ? rowDangerClass : rowButtonClass}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={`Confirm: ${description}`}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className={rowDangerClass}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        aria-label={`Cancel: ${description}`}
        onClick={() => setArmed(false)}
        className={rowButtonClass}
      >
        Cancel
      </button>
    </span>
  );
}

interface UserActionResult {
  ok?: boolean;
  user?: SafeUser;
  tempPassword?: string;
  error?: string;
}

/**
 * POST an account action. The server's own message is surfaced verbatim — the
 * last-admin guard's wording ("promote another admin first") IS the instruction
 * the admin needs, and paraphrasing it here would lose it.
 */
async function postUserAction(
  body: Record<string, unknown>,
): Promise<{ ok: true; data: UserActionResult } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/portal/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as UserActionResult;
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? "Something went wrong" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error — try again" };
  }
}

export function AccountsManager({
  users: initialUsers,
  invites: initialInvites,
  orgs,
  restaurants,
  charities,
}: {
  users: SafeUser[];
  invites: InviteRow[];
  orgs: OrgOption[];
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

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  const resolveNames = (ids: string[]) => ids.map((id) => nameById.get(id) ?? id);

  // window.location isn't available during the server render pass — fill the
  // origin in after mount so copy buttons and blurbs carry the full URL.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const joinUrl = `${origin}/portal/join`;

  // ---------- accounts state ----------
  //
  // Held locally so a disable/role change/delete lands without a reload; every
  // mutation replaces the row from the server's response rather than guessing.

  const [rows, setRows] = useState<SafeUser[]>(initialUsers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const userById = useMemo(() => new Map(rows.map((u) => [u.id, u])), [rows]);

  const replaceUser = (next: SafeUser) =>
    setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)));

  // The temp password exists only in this response/state — the server keeps
  // just its hash — so it is shown once and gone after a reload.
  const [resetResult, setResetResult] = useState<{
    user: SafeUser;
    tempPassword: string;
  } | null>(null);

  async function resetPassword(u: SafeUser) {
    setBusyId(u.id);
    setActionError(null);
    setResetResult(null);
    const result = await postUserAction({ action: "reset-password", userId: u.id });
    if (!result.ok) setActionError(result.error);
    else if (result.data.tempPassword) {
      setResetResult({ user: u, tempPassword: result.data.tempPassword });
    }
    setBusyId(null);
  }

  async function toggleDisabled(u: SafeUser) {
    setBusyId(u.id);
    setActionError(null);
    const result = await postUserAction({
      action: u.disabled ? "enable" : "disable",
      userId: u.id,
    });
    if (!result.ok) setActionError(result.error);
    else if (result.data.user) replaceUser(result.data.user);
    setBusyId(null);
  }

  async function removeUser(u: SafeUser) {
    setBusyId(u.id);
    setActionError(null);
    const result = await postUserAction({ action: "delete", userId: u.id });
    if (!result.ok) setActionError(result.error);
    else setRows((prev) => prev.filter((r) => r.id !== u.id));
    setBusyId(null);
  }

  // ---------- role editor ----------

  const [roleEditId, setRoleEditId] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<Role>("viewer");
  const [draftOrgId, setDraftOrgId] = useState("");

  function openRoleEditor(u: SafeUser) {
    setRoleEditId(u.id);
    setDraftRole(u.role);
    setDraftOrgId(u.orgId ?? "");
    setActionError(null);
  }

  async function saveRole(u: SafeUser) {
    setBusyId(u.id);
    setActionError(null);
    const result = await postUserAction({
      action: "set-role",
      userId: u.id,
      role: draftRole,
      // Staff roles must arrive without one — the users_org_binding constraint
      // rejects a staff row that still carries an org.
      orgId: isOrgRole(draftRole) ? draftOrgId : undefined,
    });
    if (!result.ok) setActionError(result.error);
    else if (result.data.user) {
      replaceUser(result.data.user);
      setRoleEditId(null);
    }
    setBusyId(null);
  }

  // ---------- invites state ----------

  const [invites, setInvites] = useState<InviteRow[]>(() =>
    [...initialInvites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  const active = invites.filter((i) => i.state === "active");
  const spent = invites.filter((i) => i.state !== "active");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);

  async function revoke(code: string) {
    setRevokingCode(code);
    setInviteError(null);
    try {
      const res = await fetch(`/api/portal/invites?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setInviteError(data.error ?? "Something went wrong");
        return;
      }
      // DELETE returns only {ok} — mirror the transition locally so the badge
      // and the Revoke button settle without a reload.
      setInvites((prev) =>
        prev.map((i): InviteRow =>
          i.code === code ? { ...i, state: "revoked", revokedAt: new Date().toISOString() } : i,
        ),
      );
    } catch {
      setInviteError("Network error — try again");
    } finally {
      setRevokingCode(null);
    }
  }

  // ---------- create-invite form state ----------

  const [role, setRole] = useState<Role>("member-business");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [orgMode, setOrgMode] = useState<"existing" | "new">(
    orgs.length > 0 ? "existing" : "new",
  );
  const [orgId, setOrgId] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgKind, setNewOrgKind] = useState<OrgKind>("business");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<InviteRow | null>(null);

  const orgRole = isOrgRole(role);
  // Which store the linked ids come from follows the ROLE, exactly as the mint
  // endpoint validates them — not the new-org kind picker, which only labels
  // the organization that redemption will create.
  const options = role === "member-business" ? restaurants : role === "org-editor" ? charities : [];

  function pickRole(next: Role) {
    setRole(next);
    setSelected(new Set());
    // A sensible default the admin can still override; the server treats the
    // kind and the role independently.
    if (next === "org-editor") setNewOrgKind("nonprofit");
    if (next === "member-business") setNewOrgKind("business");
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

  // Pre-flight only. The server (and the DB constraints behind it) is still the
  // authority; this exists so the admin sees the blocker before submitting.
  const blockedReason =
    role === "admin" && email.trim() === ""
      ? "An admin invite must be bound to an email address — an unbound admin code is a bearer grant."
      : orgRole && orgMode === "existing" && orgId === ""
        ? "Pick the organization this account joins, or switch to creating a new one."
        : orgRole && orgMode === "new" && newOrgName.trim() === ""
          ? "Name the organization this invite will create."
          : null;

  function orgNameFor(invite: InviteRow): string | null {
    if (invite.orgId) return orgById.get(invite.orgId)?.name ?? invite.orgId;
    return invite.newOrgName;
  }

  function blurbFor(invite: InviteRow): string {
    const org = orgNameFor(invite);
    const names = resolveNames(invite.linkedIds);
    const who = org
      ? ` — it sets you up as ${ROLE_LABELS[invite.role].toLowerCase()} for ${org}`
      : ` — it gives you ${ROLE_LABELS[invite.role].toLowerCase()} access`;
    const linked =
      names.length > 0
        ? `, linked to ${listNames(names)} so you can update hours, events, and listing details anytime`
        : "";
    return `Create your account at ${joinUrl} with code ${invite.code}${who}${linked}. The code expires ${fmtDate(invite.expiresAt)}.`;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          email: email.trim() || undefined,
          note: note.trim() || undefined,
          // linkedIds and the org binding are meaningless for staff roles, and
          // the invites_org_binding constraint rejects them outright.
          ...(orgRole
            ? {
                linkedIds: [...selected],
                ...(orgMode === "existing"
                  ? { orgId }
                  : { newOrgName: newOrgName.trim(), newOrgKind }),
              }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        invite?: InviteRow;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.invite) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      const invite = data.invite;
      setInvites((prev) => [invite, ...prev]);
      setFresh(invite);
      setSelected(new Set());
      setEmail("");
      setNote("");
      setNewOrgName("");
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
        {resetResult && (
          <Card className="mb-5 border-coral bg-coral/5">
            <p className="text-sm font-semibold tracking-wide text-coral-deep uppercase">
              Temporary password for {resetResult.user.name} — shown once
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="rounded-lg border border-sand bg-white px-4 py-2 font-mono text-2xl font-bold tracking-widest text-sound-deep">
                {resetResult.tempPassword}
              </code>
              <CopyButton text={resetResult.tempPassword} label="Copy password" />
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              Copy it now and hand it to{" "}
              <span className="font-medium text-ink">{resetResult.user.email}</span> — it is never
              stored in plaintext and won&apos;t be shown again. Their old password has already
              stopped working, along with any session they had open; they should change this one
              right after signing in.
            </p>
          </Card>
        )}
        <Card>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No accounts yet. The first admin is created at /portal/setup.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-sand text-xs font-semibold tracking-wide text-ink-soft uppercase">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Organization</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Last login</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <Fragment key={u.id}>
                      <tr className="border-b border-sand last:border-b-0">
                        <td className="px-3 py-3 font-medium text-ink">{u.name}</td>
                        <td className="px-3 py-3 text-ink-soft">{u.email}</td>
                        <td className="px-3 py-3">
                          <Badge tone={ROLE_TONES[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                        </td>
                        <td className="px-3 py-3 text-ink-soft">
                          {u.orgId
                            ? (orgById.get(u.orgId)?.name ?? u.orgId)
                            : u.role === "admin"
                              ? "Everything (Chamber)"
                              : "—"}
                        </td>
                        <td className="px-3 py-3">
                          {u.disabled ? (
                            <Badge tone="coral">Disabled</Badge>
                          ) : (
                            <span className="text-ink-soft">Active</span>
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-soft">
                          {u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-soft">
                          {fmtDate(u.createdAt)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              aria-label={`Change role for ${u.name}`}
                              aria-expanded={roleEditId === u.id}
                              onClick={() =>
                                roleEditId === u.id ? setRoleEditId(null) : openRoleEditor(u)
                              }
                              disabled={busyId !== null}
                              className={rowButtonClass}
                            >
                              Change role
                            </button>
                            <ConfirmButton
                              label="Reset password"
                              confirmLabel="Confirm reset"
                              description={`Reset the password for ${u.name}`}
                              onConfirm={() => resetPassword(u)}
                              disabled={busyId !== null}
                              danger={false}
                            />
                            {u.disabled ? (
                              <button
                                type="button"
                                aria-label={`Enable ${u.name}`}
                                onClick={() => toggleDisabled(u)}
                                disabled={busyId !== null}
                                className={rowButtonClass}
                              >
                                Enable
                              </button>
                            ) : (
                              <ConfirmButton
                                label="Disable"
                                confirmLabel="Confirm disable"
                                description={`Disable ${u.name}`}
                                onConfirm={() => toggleDisabled(u)}
                                disabled={busyId !== null}
                              />
                            )}
                            <ConfirmButton
                              label="Delete"
                              confirmLabel="Delete permanently"
                              description={`Delete the account for ${u.name}`}
                              onConfirm={() => removeUser(u)}
                              disabled={busyId !== null}
                            />
                          </div>
                        </td>
                      </tr>
                      {roleEditId === u.id && (
                        <tr className="border-b border-sand bg-shell last:border-b-0">
                          <td colSpan={8} className="px-3 py-4">
                            <div className="max-w-xl space-y-3">
                              <label className="block text-sm font-medium text-ink">
                                New role for {u.name}
                                <select
                                  value={draftRole}
                                  onChange={(e) => setDraftRole(e.target.value as Role)}
                                  aria-describedby="role-editor-help"
                                  className={inputClass}
                                >
                                  {ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {ROLE_LABELS[r]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <p id="role-editor-help" className="text-sm text-ink-soft">
                                {ROLE_DESCRIPTIONS[draftRole]}
                              </p>
                              {isOrgRole(draftRole) &&
                                (orgs.length === 0 ? (
                                  <p className="text-sm text-coral-deep">
                                    There are no organizations yet — invite an organization account
                                    below first.
                                  </p>
                                ) : (
                                  <label className="block text-sm font-medium text-ink">
                                    Organization
                                    <select
                                      value={draftOrgId}
                                      onChange={(e) => setDraftOrgId(e.target.value)}
                                      className={inputClass}
                                    >
                                      <option value="">Choose an organization…</option>
                                      {orgs.map((o) => (
                                        <option key={o.id} value={o.id}>
                                          {o.name} ({kindLabel[o.kind]})
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ))}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveRole(u)}
                                  disabled={
                                    busyId !== null || (isOrgRole(draftRole) && draftOrgId === "")
                                  }
                                  className={ghostButtonClass}
                                >
                                  {busyId === u.id ? "Saving…" : "Save role"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRoleEditId(null)}
                                  className={ghostButtonClass}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {actionError && <p className="mt-3 text-sm font-medium text-coral-deep">{actionError}</p>}
          <p className="mt-3 text-xs text-ink-soft">
            Passwords are hashed — they can&apos;t be viewed, only reset. Disabling, deleting, or
            changing a role signs that person out everywhere on their next request.
          </p>
        </Card>
      </Section>

      <Section
        title="Invites"
        subtitle="Codes waiting to be redeemed at /portal/join. Spent codes stay here as a record."
      >
        {inviteError && (
          <p className="mb-3 text-sm font-medium text-coral-deep">{inviteError}</p>
        )}
        {invites.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">No invites yet — create one below.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {active.map((i) => (
              <Card key={i.code}>
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded-lg border border-sand bg-shell px-3 py-1 font-mono text-lg font-bold tracking-wider text-sound-deep">
                    {i.code}
                  </code>
                  <CopyButton text={i.code} label="Copy code" />
                  <Badge tone={ROLE_TONES[i.role]}>{ROLE_LABELS[i.role]}</Badge>
                  <Badge tone={inviteStateTone[i.state]}>{inviteStateLabel[i.state]}</Badge>
                  <span className="text-xs text-ink-soft">expires {fmtDate(i.expiresAt)}</span>
                  <ConfirmButton
                    label="Revoke"
                    confirmLabel="Confirm revoke"
                    description={`Revoke invite code ${i.code}`}
                    onConfirm={() => revoke(i.code)}
                    disabled={revokingCode !== null}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <span>
                    Redeem at <span className="font-medium break-all text-ink">{joinUrl}</span>
                  </span>
                  <CopyButton text={joinUrl} label="Copy link" />
                </div>
                {orgNameFor(i) && (
                  <p className="mt-1 text-sm text-ink-soft">
                    Organization:{" "}
                    <span className="font-medium text-ink">{orgNameFor(i)}</span>
                    {i.newOrgName ? " (created on redemption)" : ""}
                  </p>
                )}
                {i.email && (
                  <p className="mt-1 text-sm text-ink-soft">
                    Only redeemable by{" "}
                    <span className="font-medium text-ink">{i.email}</span>
                  </p>
                )}
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
            {spent.map((i) => {
              const redeemer = i.usedBy ? userById.get(i.usedBy) : undefined;
              return (
                <Card key={i.code} className="bg-shell">
                  <div className="flex flex-wrap items-center gap-3 text-ink-soft">
                    <code className="font-mono text-sm line-through">{i.code}</code>
                    <Badge tone="sand">{ROLE_LABELS[i.role]}</Badge>
                    <Badge tone={inviteStateTone[i.state]}>{inviteStateLabel[i.state]}</Badge>
                    {i.state === "used" && (
                      <span className="text-xs">
                        redeemed by{" "}
                        <span className="font-medium">
                          {redeemer ? `${redeemer.name} (${redeemer.email})` : i.usedBy}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {[
                      orgNameFor(i),
                      i.email,
                      i.linkedIds.length > 0 ? resolveNames(i.linkedIds).join(", ") : null,
                      i.note,
                      `expired ${fmtDate(i.expiresAt)}`,
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
        subtitle="Mint a code, then email it to the owner — their account links itself when they redeem it. Codes expire after 14 days."
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
              <Badge tone={ROLE_TONES[fresh.role]}>{ROLE_LABELS[fresh.role]}</Badge>
              <span className="text-xs text-ink-soft">expires {fmtDate(fresh.expiresAt)}</span>
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
            <div>
              <label className="block text-sm font-medium text-ink">
                Account type
                <select
                  value={role}
                  onChange={(e) => pickRole(e.target.value as Role)}
                  aria-describedby="invite-role-help"
                  className={inputClass}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <p id="invite-role-help" className="mt-1 text-sm text-ink-soft">
                {ROLE_DESCRIPTIONS[role]}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink">
                Email binding {role === "admin" ? "(required)" : "(optional)"}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={role === "admin"}
                  aria-describedby="invite-email-help"
                  placeholder="maria@sourdoughwillys.com"
                  className={inputClass}
                />
              </label>
              <p id="invite-email-help" className="mt-1 text-sm text-ink-soft">
                Ties the code to one address, so a forwarded copy is useless to anyone else.
                Required for admin invites — an unbound admin code is a bearer grant.
              </p>
            </div>

            {orgRole && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-ink">Organization</legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="org-mode"
                      checked={orgMode === "existing"}
                      onChange={() => setOrgMode("existing")}
                      disabled={orgs.length === 0}
                      className="size-4 accent-tide"
                    />
                    Join an existing organization
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="org-mode"
                      checked={orgMode === "new"}
                      onChange={() => setOrgMode("new")}
                      className="size-4 accent-tide"
                    />
                    Create a new one
                  </label>
                </div>
                {orgMode === "existing" ? (
                  <label className="block text-sm font-medium text-ink">
                    Which organization
                    <select
                      value={orgId}
                      onChange={(e) => setOrgId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">
                        {orgs.length === 0 ? "No organizations yet" : "Choose an organization…"}
                      </option>
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({kindLabel[o.kind]})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-ink">
                      New organization name
                      <input
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                        maxLength={120}
                        placeholder="Sourdough Willy's"
                        className={inputClass}
                      />
                    </label>
                    <label className="block text-sm font-medium text-ink">
                      Kind
                      <select
                        value={newOrgKind}
                        onChange={(e) => setNewOrgKind(e.target.value as OrgKind)}
                        className={inputClass}
                      >
                        {ORG_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {kindLabel[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </fieldset>
            )}

            {orgRole && (
              <fieldset>
                <legend className="text-sm font-medium text-ink">
                  {role === "member-business"
                    ? "Restaurants this organization manages"
                    : "Organizations this account manages"}
                </legend>
                <div className="mt-1 grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-sand bg-white p-3 sm:grid-cols-2">
                  {options.length === 0 ? (
                    <p className="text-sm text-ink-soft">
                      Nothing to link yet — add{" "}
                      {role === "member-business" ? "restaurants" : "organizations"} first.
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

            {blockedReason && <p className="text-sm text-ink-soft">{blockedReason}</p>}
            {error && <p className="text-sm font-medium text-coral-deep">{error}</p>}
            <button
              type="submit"
              disabled={busy || blockedReason !== null}
              className={buttonClass}
            >
              {busy ? "Creating…" : "Create invite"}
            </button>
          </form>
        </Card>
      </Section>
    </>
  );
}
