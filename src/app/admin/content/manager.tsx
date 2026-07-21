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

async function postSite(payload: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/admin/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? "Something went wrong";
  } catch {
    return "Network error — try again";
  }
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
                // Contrast: the visible state was `bg-fern/10 text-fern`, which
                // composites to #edf2ee at 4.29:1 — and its hover made it worse,
                // 3.76:1 on bg-fern/20. Solid fern with white text is 4.86:1 in
                // both states. Hover now reads as a ring instead of a fill change,
                // which is how the sibling branch already signals hover and how
                // ferry-info's fern buttons mark their active state.
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
}: {
  blocks: CopyBlock[];
  initialOverrides: Record<string, string>;
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

  const blockByKey = useMemo(
    () => new Map(blocks.map((b) => [b.key, b])),
    [blocks],
  );

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
  const [openPages, setOpenPages] = useState<Set<string>>(() => new Set());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const savedValue = (key: string) => {
    const block = blockByKey.get(key);
    if (!block) return "";
    return hasOverride(overrides, key) ? overrides[key] : block.fallback;
  };
  const isDirty = (key: string) => drafts[key] !== savedValue(key);

  function togglePage(page: string) {
    setOpenPages((prev) => {
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
    // keeps tracking the code's wording.
    const draft = drafts[key] ?? "";
    const text = draft.trim() === "" || draft === block.fallback ? "" : draft;
    setBusyKeys((prev) => new Set(prev).add(key));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    const failure = await postSite({ action: "copy", key, text });
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
    flashSaved(key);
    return true;
  }

  async function resetBlock(key: string) {
    const block = blockByKey.get(key);
    if (!block) return;
    setBusyKeys((prev) => new Set(prev).add(key));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    const failure = await postSite({ action: "copy", key, text: "" });
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
    flashSaved(key);
  }

  async function saveGroup(pageBlocks: CopyBlock[]) {
    for (const b of pageBlocks) {
      if (isDirty(b.key)) await saveBlock(b.key);
    }
  }

  return (
    <Section
      title="Site text"
      subtitle="The headline text on every public page. Edit a block and save it; reset any time to go back to the site's built-in wording. Public pages update within a minute."
    >
      <div className="space-y-3">
        {groups.map(([page, pageBlocks]) => {
          const open = openPages.has(page);
          const editedCount = pageBlocks.filter((b) =>
            hasOverride(overrides, b.key),
          ).length;
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
                {editedCount > 0 && (
                  <Badge tone="teal">
                    {editedCount} edited
                  </Badge>
                )}
                <span className="text-xs text-ink-soft">
                  {pageBlocks.length} {pageBlocks.length === 1 ? "block" : "blocks"}
                </span>
              </button>

              {open && (
                <div className="space-y-5 border-t border-sand px-5 py-5">
                  {pageBlocks.map((b) => {
                    const overridden = hasOverride(overrides, b.key);
                    const dirty = isDirty(b.key);
                    const busy = busyKeys.has(b.key);
                    return (
                      <div key={b.key}>
                        <div className="flex flex-wrap items-center gap-2">
                          <label
                            htmlFor={`copy-${b.key}`}
                            className="text-sm font-medium text-ink"
                          >
                            {b.label}
                          </label>
                          {!overridden && !dirty && <Badge tone="sand">default</Badge>}
                          {overridden && <Badge tone="teal">edited</Badge>}
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
                        {errors[b.key] && (
                          <p className="mt-1 text-sm font-medium text-coral-deep">
                            {errors[b.key]}
                          </p>
                        )}
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
                        </div>
                        {/* E09: who edited this block + restorable history.
                            Provenance only for overridden blocks (default
                            blocks have no overlay row to describe); the
                            history panel fetches nothing until opened. */}
                        <div className="mt-2 space-y-2">
                          {overridden && (
                            <Provenance store="site-copy" recordId={b.key} />
                          )}
                          <RecordHistory store="site-copy" recordId={b.key} />
                        </div>
                      </div>
                    );
                  })}
                  {dirtyCount > 1 && (
                    <div className="border-t border-sand pt-4">
                      <button
                        type="button"
                        onClick={() => saveGroup(pageBlocks)}
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
}: {
  pages: PageRow[];
  initialHidden: string[];
  blocks: CopyBlock[];
  initialOverrides: Record<string, string>;
}) {
  return (
    <>
      <PagesSection pages={pages} initialHidden={initialHidden} />
      <CopySection blocks={blocks} initialOverrides={initialOverrides} />
    </>
  );
}
