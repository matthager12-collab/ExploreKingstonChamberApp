"use client";

// Client half of /admin/content: page show/hide toggles and the site-text
// editor. Deliberately plain (fetch + local state) in the same spirit as
// admin/accounts/manager.tsx. All authorization is server-side — this UI
// talks to /api/admin/site, which requires role admin.
//
// Copy model: the registry fallback is the wording baked into the code; an
// override replaces it. Saving a block whose text matches the fallback (or
// pressing "Reset to default") stores an empty override, which copyText
// treats as "use the fallback" — so untouched blocks track future code
// changes automatically.
//
// Three affordances make this approachable for a non-technical editor:
//  - "Show preview" embeds the live page in an iframe so she can see where a
//    block sits while editing it;
//  - an auto-restore date reverts a block to the built-in wording on a chosen
//    day (temporary/seasonal copy that cleans itself up);
//  - "Request permanent change" files a GitHub issue, because the DEFAULT
//    wording lives in code — a developer change, not an override.

import { useMemo, useState } from "react";
import type { CopyBlock } from "@/lib/site-copy-registry";
import { Badge, Card, Section } from "@/components/ui";
import { Provenance } from "@/components/admin/provenance";
import { RecordHistory } from "@/components/admin/record-history";

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const ghostButtonClass =
  "rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-tide-deep hover:border-tide disabled:opacity-50";

interface PageRow {
  path: string;
  label: string;
}

/** Copy-registry group name → a public URL to preview it in. Main pages map to
 *  themselves; shared/component groups map to a page they actually appear on.
 *  A group missing here just shows no preview toggle. */
const PAGE_PREVIEW: Record<string, string> = {
  Home: "/",
  Ferry: "/ferry",
  "Eat & Drink": "/eat",
  Events: "/events",
  Itineraries: "/itineraries",
  Stay: "/stay",
  Parking: "/parking",
  Webcams: "/webcams",
  "Town Map": "/map",
  "Restrooms & water": "/map/restrooms",
  "Give Back": "/give",
  "Scavenger Hunt": "/hunt",
  About: "/about",
  "Ferry line card": "/ferry",
  "Home — Edmonds side": "/",
  "Ferry page — Edmonds side": "/ferry",
  "Ferry line card — Edmonds side": "/ferry",
  "Near-me (client)": "/eat",
  "Scavenger hunt (client)": "/hunt",
  "Restrooms & water (client)": "/map/restrooms",
  "Webcams (client)": "/webcams",
  "Visitor survey (client)": "/",
  "Map switcher (client)": "/map",
  "Home (live strip)": "/",
  "Contact (phone fallback)": "/about",
  "Install app (client)": "/",
  "Simple mode (client)": "/simple",
  Footer: "/",
  "Ferry times (shared)": "/ferry",
  "Kingston basics (/simple)": "/simple",
  "Printable page (/print)": "/print",
  "Kingston en español (/es)": "/es",
  "Accessibility statement (/accessibility)": "/accessibility",
  "Kiosk (/kiosk)": "/kiosk",
};

interface SiteResponse {
  ok?: boolean;
  error?: string;
  url?: string;
  number?: number;
}

async function postSite(payload: Record<string, unknown>): Promise<string | null> {
  const data = await postSiteJson(payload);
  return data.ok ? null : data.error ?? "Something went wrong";
}

async function postSiteJson(payload: Record<string, unknown>): Promise<SiteResponse> {
  try {
    const res = await fetch("/api/admin/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as SiteResponse;
    if (res.ok) return { ok: true, ...data };
    return { error: data.error ?? "Something went wrong" };
  } catch {
    return { error: "Network error — try again" };
  }
}

/** "2026-09-30" → "Sep 30, 2026" for a friendly badge. */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Tomorrow (Pacific) as YYYY-MM-DD — the min a revert date can be. */
function tomorrowPacific(): string {
  const today = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  );
  today.setDate(today.getDate() + 1);
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ------------------------------- Section A ------------------------------- */

function PagesSection({
  pages,
  initialHidden,
}: {
  pages: PageRow[];
  initialHidden: string[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialHidden));
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(path: string) {
    const nextHidden = !hidden.has(path);
    setError(null);
    setBusyPath(path);
    // Optimistic: flip now, revert if the save fails.
    setHidden((prev) => {
      const next = new Set(prev);
      if (nextHidden) next.add(path);
      else next.delete(path);
      return next;
    });
    const failure = await postSite({ action: "page", path, hidden: nextHidden });
    if (failure) {
      setError(`${path}: ${failure}`);
      setHidden((prev) => {
        const next = new Set(prev);
        if (nextHidden) next.delete(path);
        else next.add(path);
        return next;
      });
    }
    setBusyPath(null);
  }

  return (
    <Section
      title="Pages"
      subtitle="Hide a page and it drops out of the menus and 404s for visitors — admins still see it, with a banner, so you can prep it. Public pages update within a minute."
    >
      <Card className="divide-y divide-sand p-0">
        {pages.map((p) => {
          const isHidden = hidden.has(p.path);
          return (
            <div
              key={p.path}
              className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                isHidden ? "bg-shell" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`font-medium ${isHidden ? "text-ink-soft" : "text-ink"}`}
                >
                  {p.label}
                  {isHidden && (
                    <span className="ml-2 align-middle">
                      <Badge tone="coral">HIDDEN</Badge>
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-soft">{p.path}</p>
              </div>
              <a
                href={p.path}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
              >
                view
              </a>
              <button
                type="button"
                onClick={() => toggle(p.path)}
                disabled={busyPath !== null}
                aria-pressed={!isHidden}
                className={`w-24 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  isHidden
                    ? "border border-sand bg-white text-ink-soft hover:border-tide"
                    : "bg-fern text-white hover:ring-2 hover:ring-fern hover:ring-offset-1"
                }`}
              >
                {busyPath === p.path ? "Saving…" : isHidden ? "Hidden" : "Visible"}
              </button>
            </div>
          );
        })}
      </Card>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-coral-deep">{error}</p>}
    </Section>
  );
}

/* ------------------------------- Section B ------------------------------- */

function CopySection({
  blocks,
  initialOverrides,
  initialExpiry,
  githubEnabled,
}: {
  blocks: CopyBlock[];
  initialOverrides: Record<string, string>;
  initialExpiry: Record<string, string>;
  githubEnabled: boolean;
}) {
  // Group blocks by page, preserving registry order.
  const groups = useMemo(() => {
    const byPage = new Map<string, CopyBlock[]>();
    for (const b of blocks) {
      const list = byPage.get(b.page);
      if (list) list.push(b);
      else byPage.set(b.page, [b]);
    }
    return [...byPage.entries()];
  }, [blocks]);

  const blockByKey = useMemo(() => new Map(blocks.map((b) => [b.key, b])), [blocks]);

  // An override "counts" only when non-blank — blank means "use the fallback".
  const hasOverride = (overrides: Record<string, string>, key: string) => {
    const t = overrides[key];
    return typeof t === "string" && t.trim().length > 0;
  };

  const [overrides, setOverrides] = useState<Record<string, string>>(
    () => ({ ...initialOverrides }),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const b of blocks) {
      d[b.key] = hasOverride(initialOverrides, b.key)
        ? initialOverrides[b.key]
        : b.fallback;
    }
    return d;
  });
  // Saved + draft auto-restore dates (key → "YYYY-MM-DD" or "").
  const [savedExpiry, setSavedExpiry] = useState<Record<string, string>>(
    () => ({ ...initialExpiry }),
  );
  const [expiryDrafts, setExpiryDrafts] = useState<Record<string, string>>(
    () => ({ ...initialExpiry }),
  );
  const [openPages, setOpenPages] = useState<Set<string>>(() => new Set());
  const [previews, setPreviews] = useState<Set<string>>(() => new Set());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // "Request permanent change" per-block state.
  const [reqOpen, setReqOpen] = useState<Set<string>>(() => new Set());
  const [reqNote, setReqNote] = useState<Record<string, string>>({});
  const [reqBusy, setReqBusy] = useState<Set<string>>(() => new Set());
  const [reqResult, setReqResult] = useState<Record<string, { url?: string; error?: string }>>({});

  const minDate = useMemo(() => tomorrowPacific(), []);

  const savedValue = (key: string) => {
    const block = blockByKey.get(key);
    if (!block) return "";
    return hasOverride(overrides, key) ? overrides[key] : block.fallback;
  };
  const isDirty = (key: string) =>
    drafts[key] !== savedValue(key) || (expiryDrafts[key] ?? "") !== (savedExpiry[key] ?? "");

  function togglePage(page: string) {
    setOpenPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }
  function togglePreview(page: string) {
    setPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  function flashSaved(key: string) {
    setSavedKeys((prev) => new Set(prev).add(key));
    setTimeout(() => {
      setSavedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 1500);
  }

  async function saveBlock(key: string): Promise<boolean> {
    const block = blockByKey.get(key);
    if (!block) return false;
    // Text identical to the fallback is stored as "" — a revert, so the block
    // keeps tracking the code's wording. A revert also clears any expiry.
    const draft = drafts[key] ?? "";
    const reverting = draft.trim() === "" || draft === block.fallback;
    const text = reverting ? "" : draft;
    const expiresAt = reverting ? null : (expiryDrafts[key] || null);
    setBusyKeys((prev) => new Set(prev).add(key));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    const failure = await postSite({ action: "copy", key, text, expiresAt });
    setBusyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (failure) {
      setErrors((prev) => ({ ...prev, [key]: failure }));
      return false;
    }
    setOverrides((prev) => ({ ...prev, [key]: text }));
    setDrafts((prev) => ({ ...prev, [key]: text === "" ? block.fallback : text }));
    setSavedExpiry((prev) => ({ ...prev, [key]: expiresAt ?? "" }));
    setExpiryDrafts((prev) => ({ ...prev, [key]: expiresAt ?? "" }));
    flashSaved(key);
    return true;
  }

  async function resetBlock(key: string) {
    const block = blockByKey.get(key);
    if (!block) return;
    setBusyKeys((prev) => new Set(prev).add(key));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    const failure = await postSite({ action: "copy", key, text: "", expiresAt: null });
    setBusyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (failure) {
      setErrors((prev) => ({ ...prev, [key]: failure }));
      return;
    }
    setOverrides((prev) => ({ ...prev, [key]: "" }));
    setDrafts((prev) => ({ ...prev, [key]: block.fallback }));
    setSavedExpiry((prev) => ({ ...prev, [key]: "" }));
    setExpiryDrafts((prev) => ({ ...prev, [key]: "" }));
    flashSaved(key);
  }

  function toggleReq(key: string) {
    setReqOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submitReq(key: string) {
    setReqBusy((prev) => new Set(prev).add(key));
    setReqResult((prev) => ({ ...prev, [key]: {} }));
    const data = await postSiteJson({
      action: "request-permanent",
      key,
      text: drafts[key] ?? "",
      note: reqNote[key] ?? "",
    });
    setReqBusy((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setReqResult((prev) => ({
      ...prev,
      [key]: data.ok ? { url: data.url } : { error: data.error },
    }));
  }

  return (
    <Section
      title="Site text"
      subtitle="The text on every public page. Edit a block and save it; set a date to have it revert to the built-in wording on its own; or ask for a permanent change. Public pages update within a minute."
    >
      <div className="space-y-3">
        {groups.map(([page, pageBlocks]) => {
          const open = openPages.has(page);
          const previewUrl = PAGE_PREVIEW[page];
          const showPreview = previews.has(page);
          const editedCount = pageBlocks.filter((b) => hasOverride(overrides, b.key)).length;
          const dirtyCount = pageBlocks.filter((b) => isDirty(b.key)).length;
          return (
            <Card key={page} className="p-0">
              <button
                type="button"
                onClick={() => togglePage(page)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <span className="text-ink-soft" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <span className="font-display flex-1 text-lg font-semibold text-sound-deep">
                  {page}
                </span>
                {editedCount > 0 && <Badge tone="teal">{editedCount} edited</Badge>}
                <span className="text-xs text-ink-soft">
                  {pageBlocks.length} {pageBlocks.length === 1 ? "block" : "blocks"}
                </span>
              </button>

              {open && (
                <div className="space-y-5 border-t border-sand px-5 py-5">
                  {previewUrl && (
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                      >
                        View this page ↗
                      </a>
                      <button
                        type="button"
                        onClick={() => togglePreview(page)}
                        aria-expanded={showPreview}
                        className={ghostButtonClass}
                      >
                        {showPreview ? "Hide preview" : "Show preview"}
                      </button>
                    </div>
                  )}
                  {previewUrl && showPreview && (
                    <div className="overflow-hidden rounded-xl border border-sand">
                      <iframe
                        src={previewUrl}
                        title={`Live preview of ${page}`}
                        loading="lazy"
                        className="block h-[520px] w-full bg-white"
                      />
                    </div>
                  )}

                  {pageBlocks.map((b) => {
                    const overridden = hasOverride(overrides, b.key);
                    const dirty = isDirty(b.key);
                    const busy = busyKeys.has(b.key);
                    const savedDate = savedExpiry[b.key];
                    const result = reqResult[b.key];
                    return (
                      <div key={b.key} className="border-t border-sand/60 pt-4 first:border-t-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`copy-${b.key}`} className="text-sm font-medium text-ink">
                            {b.label}
                          </label>
                          {!overridden && !dirty && <Badge tone="sand">default</Badge>}
                          {overridden && <Badge tone="teal">edited</Badge>}
                          {savedDate && <Badge tone="coral">reverts {prettyDate(savedDate)}</Badge>}
                          {savedKeys.has(b.key) && <Badge tone="green">Saved</Badge>}
                        </div>
                        {b.multiline ? (
                          <textarea
                            id={`copy-${b.key}`}
                            value={drafts[b.key] ?? ""}
                            onChange={(e) =>
                              setDrafts((prev) => ({ ...prev, [b.key]: e.target.value }))
                            }
                            rows={3}
                            maxLength={2000}
                            className={inputClass}
                          />
                        ) : (
                          <input
                            id={`copy-${b.key}`}
                            value={drafts[b.key] ?? ""}
                            onChange={(e) =>
                              setDrafts((prev) => ({ ...prev, [b.key]: e.target.value }))
                            }
                            maxLength={2000}
                            className={inputClass}
                          />
                        )}
                        {b.rich && (
                          <p className="mt-1 text-xs text-ink-soft">
                            Supports **bold** and [links](url).
                          </p>
                        )}
                        {/* The built-in wording, so it's clear what Reset (or an
                            auto-restore date) brings back. Only shown when the
                            block is currently overridden — otherwise the box
                            above already shows it. */}
                        {overridden && (
                          <p className="mt-1 text-xs text-ink-soft">
                            <span className="font-semibold">Built-in wording:</span> {b.fallback}
                          </p>
                        )}
                        {errors[b.key] && (
                          <p className="mt-1 text-sm font-medium text-coral-deep">{errors[b.key]}</p>
                        )}

                        {/* Auto-restore date — a block reverts to the built-in
                            wording on this day, then this control clears. */}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                          <label htmlFor={`expiry-${b.key}`}>Revert to the built-in wording on</label>
                          <input
                            id={`expiry-${b.key}`}
                            type="date"
                            min={minDate}
                            value={expiryDrafts[b.key] ?? ""}
                            onChange={(e) =>
                              setExpiryDrafts((prev) => ({ ...prev, [b.key]: e.target.value }))
                            }
                            className="rounded-lg border border-sand bg-white px-2 py-1 text-sm"
                          />
                          {expiryDrafts[b.key] && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpiryDrafts((prev) => ({ ...prev, [b.key]: "" }))
                              }
                              className="text-tide-deep underline underline-offset-2"
                            >
                              clear
                            </button>
                          )}
                          <span className="text-ink-soft/80">(optional — leave blank to keep it until you change it)</span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => saveBlock(b.key)}
                            disabled={busy || !dirty}
                            className={buttonClass}
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                          {overridden && (
                            <button
                              type="button"
                              onClick={() => resetBlock(b.key)}
                              disabled={busy}
                              className={ghostButtonClass}
                            >
                              Reset to default
                            </button>
                          )}
                          {githubEnabled && (
                            <button
                              type="button"
                              onClick={() => toggleReq(b.key)}
                              className={ghostButtonClass}
                            >
                              Request permanent change
                            </button>
                          )}
                        </div>

                        {/* Request-permanent form: files a GitHub issue asking a
                            developer to make the wording in the box above the
                            built-in default. */}
                        {githubEnabled && reqOpen.has(b.key) && (
                          <div className="mt-3 rounded-xl border border-sand bg-shell/60 p-3">
                            <p className="text-sm text-ink">
                              Ask a developer to make the wording in the box above the permanent
                              built-in text (a code change). Your request is filed as a tracked
                              issue.
                            </p>
                            <textarea
                              value={reqNote[b.key] ?? ""}
                              onChange={(e) =>
                                setReqNote((prev) => ({ ...prev, [b.key]: e.target.value }))
                              }
                              rows={2}
                              maxLength={1000}
                              placeholder="Optional note for the developer (why, when it's needed, etc.)"
                              className={inputClass}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => submitReq(b.key)}
                                disabled={reqBusy.has(b.key)}
                                className={buttonClass}
                              >
                                {reqBusy.has(b.key) ? "Sending…" : "Send request"}
                              </button>
                              {result?.url && (
                                <span className="text-sm text-fern">
                                  Request filed —{" "}
                                  <a
                                    href={result.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-semibold underline underline-offset-2"
                                  >
                                    view it ↗
                                  </a>
                                </span>
                              )}
                              {result?.error && (
                                <span className="text-sm font-medium text-coral-deep">
                                  {result.error}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* E09: who edited this block + restorable history. */}
                        <div className="mt-2 space-y-2">
                          {overridden && <Provenance store="site-copy" recordId={b.key} />}
                          <RecordHistory store="site-copy" recordId={b.key} />
                        </div>
                      </div>
                    );
                  })}
                  {dirtyCount > 1 && (
                    <div className="border-t border-sand pt-4">
                      <button
                        type="button"
                        onClick={async () => {
                          for (const b of pageBlocks) if (isDirty(b.key)) await saveBlock(b.key);
                        }}
                        disabled={busyKeys.size > 0}
                        className={buttonClass}
                      >
                        Save all {dirtyCount} changes on this page
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-ink-soft">Public pages update within a minute.</p>
    </Section>
  );
}

/* --------------------------------- Export -------------------------------- */

export function ContentManager({
  pages,
  initialHidden,
  blocks,
  initialOverrides,
  initialExpiry,
  githubEnabled,
}: {
  pages: PageRow[];
  initialHidden: string[];
  blocks: CopyBlock[];
  initialOverrides: Record<string, string>;
  initialExpiry: Record<string, string>;
  githubEnabled: boolean;
}) {
  return (
    <>
      <PagesSection pages={pages} initialHidden={initialHidden} />
      <CopySection
        blocks={blocks}
        initialOverrides={initialOverrides}
        initialExpiry={initialExpiry}
        githubEnabled={githubEnabled}
      />
    </>
  );
}
