"use client";

// Client half of /admin/claims (E17 claims console). Phone-first: one table,
// big touch targets, everything reachable in a couple of taps while the
// Chamber has the business owner on the phone.
//
// Actions: invite minting POSTs to /api/portal/invites (admin-gated
// server-side), with the role DERIVED from the listing's store — never
// operator-typed. Releasing a claim POSTs to /api/admin/claims/release, the
// only way in the product to take owner_org_id back off a listing; it is
// confirm-gated because it revokes a business's access to its own listing.
// Recording a claim's outcome (invited / rejected / duplicate) happens on
// /admin/worklist.
//
// Claim state is the UNION of two halves — the record's owner stamp and the
// org's edit grant (src/lib/claims/console-data.ts). When they disagree the
// row says "needs attention" and explains, rather than rendering a confident
// Claimed/Unclaimed over a listing nobody can actually edit.
//
// Everything a request-submitter typed is rendered as clearly-attributed
// SECONDARY text: claim intake is a public endpoint, so payload.businessName
// is an unauthenticated caller's string. The headline is always the
// server-derived subject label.
//
// Admin-only surface: plain strings, not the public copy registry.

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { Badge, Card, Section } from "@/components/ui";
import {
  CLAIM_INVITE_ROLE_BY_STORE,
  CLAIM_STORES,
  CLAIM_STORE_LABELS,
  isClaimStore,
  type ClaimStore,
} from "@/lib/claims/roles";
import { ROLE_LABELS } from "@/lib/auth/roles";

/** An org holding the grant half of a claim. */
export interface ClaimGrantOrgView {
  id: string;
  name: string;
}

/** Mirrors ClaimsConsoleRow (src/lib/claims/console-data.ts) — re-declared
 *  type-only here because that module is `server-only`; the shared runtime
 *  values (stores, labels, role map) come from @/lib/claims/roles instead. */
export interface ClaimsRowView {
  store: ClaimStore;
  id: string;
  name: string;
  status: string;
  source: string;
  claimed: boolean;
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  grantOrgs: ClaimGrantOrgView[];
  mismatch: "grant-without-owner" | "owner-without-grant" | "conflicting-orgs" | null;
}

/** Live invite codes already out there for a listing, joined by the server. */
export interface OutstandingInviteView {
  count: number;
  /** Soonest expiry among them, ISO. */
  expiresAt: string;
}

/** An open claim_request worklist item, dates pre-serialized. */
export interface OpenClaimView {
  id: string;
  subjectStore: string;
  subjectId: string;
  subjectLabel: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const selectClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base sm:w-auto";
const buttonClass =
  "rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
// Destructive confirm. Solid coral with white text is ~5:1 (globals.css), so
// the emphasis is not carried by color alone — the button says what it does.
const dangerButtonClass =
  "rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep disabled:opacity-50";
const ghostButtonClass =
  "rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-tide-deep hover:border-tide disabled:opacity-50";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rowDomId(store: string, id: string): string {
  return `claim-row-${store}-${id}`;
}

// window.location isn't available during the server render pass. Read it via
// useSyncExternalStore (server snapshot "") rather than a mount effect — the
// set-state-in-effect lint rule is an error for new files, deliberately.
const emptySubscribe = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => "",
  );
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
          // Clipboard unavailable (plain-http LAN) — the text is visible to select.
        }
      }}
      className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-0.5 text-xs font-semibold text-tide-deep hover:border-tide"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function plain(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function orgList(orgs: ClaimGrantOrgView[]): string {
  return orgs.map((o) => o.name).join(" and ");
}

/** Everyone who holds any part of this claim, for the confirm copy. */
function holdersOf(r: ClaimsRowView): string {
  const names = [
    ...(r.ownerOrgId ? [r.ownerOrgName ?? r.ownerOrgId] : []),
    ...r.grantOrgs.filter((g) => g.id !== r.ownerOrgId).map((g) => g.name),
  ];
  return names.join(" and ") || "this organization";
}

/** Plain-language explanation of a grant/stamp disagreement — the admin has
 *  to be able to act on it without knowing the column names. */
function mismatchText(r: ClaimsRowView): string {
  switch (r.mismatch) {
    case "grant-without-owner":
      return `${orgList(r.grantOrgs)} can already edit this listing, but it is not recorded as the owner. Usually a claim that half-finished. Release it, then invite the owner again.`;
    case "owner-without-grant":
      return `${r.ownerOrgName ?? r.ownerOrgId} is recorded as the owner but has no edit access, so they will hit a permission error on their own listing. Release it, then invite them again.`;
    case "conflicting-orgs":
      return `More than one organization holds this listing (${holdersOf(r)}). Release it, then invite only the right one.`;
    default:
      return "";
  }
}

/** Wire shape of a minted invite — only the fields this panel shows. */
interface MintedInvite {
  code: string;
  expiresAt: string;
}

export function ClaimsManager({
  rows: serverRows,
  claims,
  outstandingInvites = {},
}: {
  rows: ClaimsRowView[];
  claims: OpenClaimView[];
  outstandingInvites?: Record<string, OutstandingInviteView>;
}) {
  // A released row is re-rendered from the server's own assembly of it (the
  // release response returns the row), so the table never has to guess what
  // the new state is.
  const [released, setReleased] = useState<Record<string, ClaimsRowView>>({});
  const rows = useMemo(
    () => serverRows.map((r) => released[`${r.store}/${r.id}`] ?? r),
    [serverRows, released],
  );

  // Codes minted in THIS session, so re-opening the panel still warns about
  // the code the operator just created (the server prop is a page-load join).
  const [mintedCounts, setMintedCounts] = useState<Record<string, number>>({});

  /** Live codes already out there for a listing. */
  function outstandingFor(id: string): { count: number; expiresAt: string | null } {
    const base = outstandingInvites[id];
    const count = (base?.count ?? 0) + (mintedCounts[id] ?? 0);
    return { count, expiresAt: base?.expiresAt ?? null };
  }

  // ---------- filters (client-side; ~220 rows) ----------

  const [storeFilter, setStoreFilter] = useState<ClaimStore | "all">("all");
  const [claimedFilter, setClaimedFilter] = useState<"all" | "claimed" | "unclaimed">("all");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (storeFilter !== "all" && r.store !== storeFilter) return false;
      if (claimedFilter === "claimed" && !r.claimed) return false;
      if (claimedFilter === "unclaimed" && r.claimed) return false;
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.id.toLowerCase().includes(q) &&
        !(r.ownerOrgName ?? "").toLowerCase().includes(q) &&
        !r.grantOrgs.some((g) => g.name.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [rows, storeFilter, claimedFilter, search]);

  const rowKeys = useMemo(() => new Set(rows.map((r) => `${r.store}/${r.id}`)), [rows]);

  // ---------- deep link: claim card → listing row ----------

  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  function jumpToRow(store: string, id: string) {
    // Clear the filters first so the target row is guaranteed rendered, then
    // scroll + focus it after React commits.
    setStoreFilter("all");
    setClaimedFilter("all");
    setSearch("");
    setHighlightKey(`${store}/${id}`);
  }

  useEffect(() => {
    if (!highlightKey) return;
    const [store, ...idParts] = highlightKey.split("/");
    const el = document.getElementById(rowDomId(store, idParts.join("/")));
    if (el) {
      el.scrollIntoView({ block: "center" });
      (el as HTMLElement).focus();
    }
  }, [highlightKey]);

  // ---------- invite minting (one open panel at a time) ----------

  const [openInviteKey, setOpenInviteKey] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedInvite | null>(null);

  // ---------- claim release (destructive: confirm-gated) ----------

  const [openReleaseKey, setOpenReleaseKey] = useState<string | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Full URL for the copyable join link ("" during the server render pass).
  const origin = useOrigin();

  function openInvitePanel(key: string) {
    setOpenReleaseKey(null);
    setOpenInviteKey(key);
    setEmail("");
    setInviteError(null);
    setMinted(null);
  }

  function openReleasePanel(key: string) {
    setOpenInviteKey(null);
    setOpenReleaseKey(key);
    setReleaseError(null);
  }

  async function mintInvite(e: FormEvent<HTMLFormElement>, row: ClaimsRowView) {
    e.preventDefault();
    setBusy(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The role is derived from the store — the whole point of the
          // console is that this can't be typed wrong.
          role: CLAIM_INVITE_ROLE_BY_STORE[row.store],
          linkedIds: [row.id],
          newOrgName: row.name,
          email: email.trim() || undefined,
          note: `claims console: ${row.name}`,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        invite?: MintedInvite;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.invite) {
        // 409 = already claimed; the server names the holding org in its
        // message and points at the release control below.
        setInviteError(data.error ?? "Something went wrong");
        return;
      }
      setMinted(data.invite);
      setMintedCounts((m) => ({ ...m, [row.id]: (m[row.id] ?? 0) + 1 }));
    } catch {
      setInviteError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function releaseClaim(row: ClaimsRowView) {
    const key = `${row.store}/${row.id}`;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      const res = await fetch("/api/admin/claims/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: row.store, id: row.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        row?: ClaimsRowView | null;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setReleaseError(data.error ?? "Something went wrong");
        return;
      }
      if (data.row) setReleased((prev) => ({ ...prev, [key]: data.row! }));
      setOpenReleaseKey(null);
      setActionStatus(
        `Released the claim on ${row.name}. It is unclaimed again and can be invited.`,
      );
    } catch {
      setReleaseError("Network error — try again");
    } finally {
      setReleaseBusy(false);
    }
  }

  // ---------- render ----------

  const claimedCount = rows.filter((r) => r.claimed).length;
  const attentionCount = rows.filter((r) => r.mismatch !== null).length;

  return (
    <>
      {claims.length > 0 && (
        <Section
          title="Claim requests waiting"
          subtitle="Owners who asked to claim their listing. Verify by phone — call the number on the listing, not the number in the request — then mint the invite from the row below and record the outcome on the worklist."
        >
          <ul className="space-y-3">
            {claims.map((c) => {
              // Server-derived subject wins over anything in the payload:
              // claim intake is a PUBLIC endpoint, so the payload's store,
              // id, and businessName are all attacker-controllable strings.
              const store = c.subjectStore;
              const id = c.subjectId;
              const known = rowKeys.has(`${store}/${id}`);
              const count = Number(c.payload.count ?? 1);
              const submittedName = plain(c.payload.businessName);
              return (
                <li key={c.id}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sound-deep">{c.subjectLabel}</span>
                      {isClaimStore(store) && (
                        <Badge tone="teal">{CLAIM_STORE_LABELS[store]}</Badge>
                      )}
                      {count > 1 && <Badge tone="sand">{count} requests</Badge>}
                      <span className="text-xs text-ink-soft">
                        {fmtDate(c.createdAt)}
                      </span>
                    </div>
                    <dl className="mt-2 space-y-1 text-sm">
                      {submittedName !== "—" && submittedName !== c.subjectLabel && (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="font-medium text-ink">Submitted as:</dt>
                          <dd className="min-w-0 break-words text-ink-soft">
                            {submittedName}
                          </dd>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-ink">First requester:</dt>
                        <dd className="min-w-0 break-words text-ink-soft">
                          {plain(c.payload.contactName)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-ink">
                          First requester&rsquo;s contact:
                        </dt>
                        <dd className="min-w-0 break-words text-ink-soft">
                          {plain(c.payload.contact)}
                        </dd>
                      </div>
                      {plain(c.payload.message) !== "—" && (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="font-medium text-ink">Message:</dt>
                          <dd className="min-w-0 break-words text-ink-soft">
                            {plain(c.payload.message)}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {count > 1 && (
                      // First-writer-wins (mergePayloads in lib/db/worklist):
                      // a repeat request bumps the count and changes nothing
                      // else, so the name and number above belong to whoever
                      // asked FIRST — not to whoever asked most recently.
                      <p className="mt-1 text-xs text-ink-soft">
                        {count} people have asked about this listing. Later
                        requests add to that count only — the details above are
                        the first requester&rsquo;s. Verify against the
                        listing&rsquo;s published phone number either way.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {known ? (
                        <button
                          type="button"
                          onClick={() => jumpToRow(store, id)}
                          className={ghostButtonClass}
                        >
                          Show listing below
                        </button>
                      ) : (
                        <span className="text-sm text-ink-soft">
                          Listing not found — it may have been removed. Resolve the
                          request on the worklist.
                        </span>
                      )}
                      <a
                        href="/admin/worklist"
                        className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                      >
                        Record the outcome on the worklist
                      </a>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section
        title="Listings"
        subtitle={`${claimedCount} of ${rows.length} listings are claimed by their owners. Inviting an owner creates their organization and links it to the listing when they redeem the code.`}
      >
        <Card>
          {attentionCount > 0 && (
            <p className="mb-3 rounded-lg border border-coral bg-coral/5 px-3 py-2 text-sm text-ink">
              <span className="font-semibold">
                {attentionCount} listing{attentionCount === 1 ? "" : "s"} need
                {attentionCount === 1 ? "s" : ""} attention.
              </span>{" "}
              A claim has two halves — the listing records its owner, and the
              organization is given edit access. Where only one half landed, the
              row below says so. Releasing the claim resets both.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium text-ink">
              Type
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value as ClaimStore | "all")}
                className={selectClass}
              >
                <option value="all">All types</option>
                {CLAIM_STORES.map((s) => (
                  <option key={s} value={s}>
                    {CLAIM_STORE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink">
              Claimed
              <select
                value={claimedFilter}
                onChange={(e) =>
                  setClaimedFilter(e.target.value as "all" | "claimed" | "unclaimed")
                }
                className={selectClass}
              >
                <option value="all">Claimed &amp; unclaimed</option>
                <option value="claimed">Claimed only</option>
                <option value="unclaimed">Unclaimed only</option>
              </select>
            </label>
            <label className="block min-w-40 flex-1 text-sm font-medium text-ink">
              Search
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="listing or organization name"
                className={inputClass}
              />
            </label>
          </div>

          <p className="mt-3 text-sm text-ink-soft" role="status">
            Showing {visible.length} of {rows.length} listings.
            {actionStatus ? ` ${actionStatus}` : ""}
          </p>

          {visible.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No listings match these filters.
            </p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-xs font-semibold tracking-wide text-ink-soft uppercase">
                  <th scope="col" className="py-2 pr-3">
                    Listing
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Claimed
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const key = `${r.store}/${r.id}`;
                  const inviteOpen = openInviteKey === key;
                  const releaseOpen = openReleaseKey === key;
                  const role = CLAIM_INVITE_ROLE_BY_STORE[r.store];
                  const live = outstandingFor(r.id);
                  return (
                    <Fragment key={key}>
                      <tr
                        id={rowDomId(r.store, r.id)}
                        tabIndex={-1}
                        className={`border-b border-sand last:border-b-0 ${
                          highlightKey === key ? "bg-tide/5" : ""
                        }`}
                      >
                        <td className="py-3 pr-3">
                          <span className="block font-medium text-ink">{r.name}</span>
                          <span className="block text-xs text-ink-soft">
                            {CLAIM_STORE_LABELS[r.store]}
                            {r.status !== "live" ? ` · ${r.status}` : ""}
                            {r.source === "import" ? " · imported" : ""}
                          </span>
                        </td>
                        <td className="py-3 pr-3">
                          {r.mismatch !== null ? (
                            <>
                              <Badge tone="coral">Needs attention</Badge>
                              <span className="mt-1 block text-xs break-words text-ink-soft">
                                {mismatchText(r)}
                              </span>
                            </>
                          ) : r.claimed ? (
                            <>
                              <Badge tone="green">Claimed</Badge>
                              <span className="mt-1 block text-xs break-words text-ink-soft">
                                {r.ownerOrgName}
                              </span>
                            </>
                          ) : (
                            <>
                              <Badge tone="sand">Unclaimed</Badge>
                              {live.count > 0 && (
                                <span className="mt-1 block text-xs break-words text-ink-soft">
                                  {live.count === 1
                                    ? "An invite is already outstanding"
                                    : `${live.count} invites are already outstanding`}
                                  {live.expiresAt ? ` (expires ${fmtDate(live.expiresAt)})` : ""}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="py-3">
                          {r.claimed ? (
                            <button
                              type="button"
                              aria-label={`Release the claim on ${r.name}`}
                              aria-expanded={releaseOpen}
                              disabled={releaseBusy}
                              onClick={() =>
                                releaseOpen ? setOpenReleaseKey(null) : openReleasePanel(key)
                              }
                              className={ghostButtonClass}
                            >
                              Release claim
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Invite the owner of ${r.name} to claim it`}
                              aria-expanded={inviteOpen}
                              disabled={busy}
                              onClick={() =>
                                inviteOpen ? setOpenInviteKey(null) : openInvitePanel(key)
                              }
                              className={ghostButtonClass}
                            >
                              Invite owner
                            </button>
                          )}
                        </td>
                      </tr>
                      {releaseOpen && (
                        <tr className="border-b border-sand bg-shell last:border-b-0">
                          <td colSpan={3} className="px-3 py-4">
                            <div className="max-w-xl space-y-3">
                              <p className="text-sm font-semibold tracking-wide text-coral-deep uppercase">
                                Release this claim?
                              </p>
                              <p className="text-sm text-ink">
                                This revokes {holdersOf(r)}&rsquo;s access to{" "}
                                <span className="font-semibold">{r.name}</span>: the
                                listing stops recording them as its owner and is
                                unlinked from their organization, so signing in no
                                longer lets them edit it. Their account and every other
                                listing they hold are untouched, and the listing keeps
                                its current content. Do this when a claim went to the
                                wrong business — then invite the right one.
                              </p>
                              {releaseError && (
                                <p role="alert" className="text-sm font-medium text-coral-deep">
                                  {releaseError}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void releaseClaim(r)}
                                  disabled={releaseBusy}
                                  className={dangerButtonClass}
                                >
                                  {releaseBusy ? "Releasing…" : "Yes, release the claim"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOpenReleaseKey(null)}
                                  className={ghostButtonClass}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {inviteOpen && (
                        <tr className="border-b border-sand bg-shell last:border-b-0">
                          <td colSpan={3} className="px-3 py-4">
                            {minted ? (
                              <div className="max-w-xl space-y-3">
                                <p className="text-sm font-semibold tracking-wide text-tide-deep uppercase">
                                  Invite created — share this link
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <code className="rounded-lg border border-sand bg-white px-3 py-1.5 font-mono text-sm font-bold break-all text-sound-deep">
                                    {`${origin}/portal/join?code=${encodeURIComponent(minted.code)}`}
                                  </code>
                                  <CopyButton
                                    text={`${origin}/portal/join?code=${encodeURIComponent(minted.code)}`}
                                    label="Copy join link"
                                  />
                                </div>
                                <p className="text-sm text-ink-soft">
                                  Or read the code aloud on the phone:{" "}
                                  <code className="font-mono font-bold text-sound-deep">
                                    {minted.code}
                                  </code>{" "}
                                  at {origin}/portal/join. It expires{" "}
                                  {fmtDate(minted.expiresAt)}. When you&apos;re done, record
                                  the outcome as &ldquo;invited&rdquo; on{" "}
                                  <a
                                    href="/admin/worklist"
                                    className="font-medium text-tide-deep underline"
                                  >
                                    the worklist
                                  </a>
                                  .
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setOpenInviteKey(null)}
                                  className={ghostButtonClass}
                                >
                                  Done
                                </button>
                              </div>
                            ) : (
                              <form
                                onSubmit={(e) => void mintInvite(e, r)}
                                className="max-w-xl space-y-3"
                              >
                                <p className="text-sm text-ink">
                                  Mints a{" "}
                                  <span className="font-semibold">
                                    {ROLE_LABELS[role].toLowerCase()}
                                  </span>{" "}
                                  invite linked to{" "}
                                  <span className="font-semibold">{r.name}</span>. Redeeming
                                  it creates an organization named &ldquo;{r.name}&rdquo; that
                                  owns this listing.
                                </p>
                                {live.count > 0 && (
                                  <p className="rounded-lg border border-coral bg-coral/5 px-3 py-2 text-sm text-ink">
                                    <span className="font-semibold">
                                      {live.count === 1
                                        ? "A code for this listing is already out there"
                                        : `${live.count} codes for this listing are already out there`}
                                      {live.expiresAt
                                        ? ` (expires ${fmtDate(live.expiresAt)}).`
                                        : "."}
                                    </span>{" "}
                                    Only the first person to redeem gets the listing; a
                                    second code leaves the other person stuck. If the
                                    first went to the wrong address, revoke it on{" "}
                                    <a
                                      href="/admin/accounts"
                                      className="font-medium text-tide-deep underline"
                                    >
                                      the accounts page
                                    </a>{" "}
                                    first.
                                  </p>
                                )}
                                <label className="block text-sm font-medium text-ink">
                                  Email binding (optional)
                                  <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="owner@example.com"
                                    className={inputClass}
                                  />
                                </label>
                                <p className="text-xs text-ink-soft">
                                  Binding ties the code to one address, so a forwarded copy
                                  is useless to anyone else.
                                </p>
                                {inviteError && (
                                  <p role="alert" className="text-sm font-medium text-coral-deep">
                                    {inviteError}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                  <button type="submit" disabled={busy} className={buttonClass}>
                                    {busy ? "Creating…" : "Create invite"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setOpenInviteKey(null)}
                                    className={ghostButtonClass}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </Section>
    </>
  );
}
