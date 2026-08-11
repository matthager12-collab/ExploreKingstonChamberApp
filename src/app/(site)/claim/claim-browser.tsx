"use client";

// E17 claim-signup slice: the searchable, filterable index of imported
// business listings on /claim. Pure presentation over the public projection
// (id / name / category / claimed) — the server page resolved everything
// else away, so nothing here can leak draft content.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCopy } from "@/lib/copy-context";
import type { ClaimableBusiness } from "@/lib/claims/self-signup";

// Same labels the admin workbench and business portal use for the category
// vocabulary (DirectoryListing["category"]).
const CATEGORY_LABEL: Record<string, string> = {
  eat: "Eat & Drink",
  stay: "Stay",
  shop: "Shop",
  services: "Services",
  activities: "Activities",
  community: "Community",
  other: "Directory",
};

const chipBase = "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors";
const chipOn = `${chipBase} border-sound bg-sound text-white`;
const chipOff = `${chipBase} border-sand bg-white text-ink hover:border-tide`;

export function ClaimBrowser({ businesses }: { businesses: ClaimableBusiness[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const searchLabel = useCopy("claimPage.search.label");
  const searchPlaceholder = useCopy("claimPage.search.placeholder");
  const allLabel = useCopy("claimPage.filter.all");
  const claimedBadge = useCopy("claimPage.claimedBadge");
  const rowCta = useCopy("claimPage.row.cta");
  const emptyText = useCopy("claimPage.empty");

  const categories = useMemo(() => {
    const present = new Set(businesses.map((b) => b.category));
    // Stable vocabulary order, only the categories that actually occur.
    return Object.keys(CATEGORY_LABEL).filter((c) => present.has(c));
  }, [businesses]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return businesses.filter(
      (b) =>
        (category === "all" || b.category === category) &&
        (q === "" || b.name.toLowerCase().includes(q)),
    );
  }, [businesses, category, query]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <label htmlFor="claim-search" className="sr-only">
          {searchLabel}
        </label>
        <input
          id="claim-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="block w-full max-w-md rounded-lg border border-sand bg-white px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label={searchLabel}>
          <button
            type="button"
            className={category === "all" ? chipOn : chipOff}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            {allLabel}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? chipOn : chipOff}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-soft">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-sand rounded-xl border border-sand bg-white/60">
          {shown.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{b.name}</p>
                <p className="text-xs text-ink-soft">{CATEGORY_LABEL[b.category] ?? b.category}</p>
              </div>
              {b.claimed ? (
                <span className="rounded-full bg-sand/70 px-3 py-1 text-xs font-medium text-ink">
                  {claimedBadge}
                </span>
              ) : (
                <Link
                  href={`/claim/${b.id}`}
                  className="rounded-full bg-sound px-4 py-1.5 text-xs font-semibold text-white hover:bg-sound-deep"
                  aria-label={`${rowCta} — ${b.name}`}
                >
                  {rowCta}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
