"use client";

// Public directory browser (directory-public slice, phase 2): search +
// category chips over the RANKED projection the server page computed
// (active members first, dues desc, alphabetical — src/lib/directory/rank.ts).
// Filtering never re-orders: whatever survives the filter keeps its rank.
// Pure presentation — dues amounts never reach this component, only the
// member-or-not fact.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCopy } from "@/lib/copy-context";

// Same labels the admin workbench, business portal, and /claim use.
const CATEGORY_LABEL: Record<string, string> = {
  eat: "Eat & Drink",
  stay: "Stay",
  shop: "Shop",
  services: "Services",
  activities: "Activities",
  community: "Community",
  other: "Directory",
};

export interface DirectoryRow {
  id: string;
  name: string;
  category: string;
  blurb: string;
  isMember: boolean;
}

const chipBase = "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors";
const chipOn = `${chipBase} border-sound bg-sound text-white`;
const chipOff = `${chipBase} border-sand bg-white text-ink hover:border-tide`;

export function DirectoryBrowser({ rows }: { rows: DirectoryRow[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const searchLabel = useCopy("directoryPage.search.label");
  const searchPlaceholder = useCopy("directoryPage.search.placeholder");
  const allLabel = useCopy("directoryPage.filter.all");
  const memberBadge = useCopy("directoryPage.memberBadge");
  const emptyText = useCopy("directoryPage.empty");

  const categories = useMemo(() => {
    const present = new Set(rows.map((r) => r.category));
    return Object.keys(CATEGORY_LABEL).filter((c) => present.has(c));
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (category === "all" || r.category === category) &&
        (q === "" || r.name.toLowerCase().includes(q)),
    );
  }, [rows, category, query]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <label htmlFor="directory-search" className="sr-only">
          {searchLabel}
        </label>
        <input
          id="directory-search"
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                href={`/directory/${r.id}`}
                className="block h-full rounded-xl border border-sand bg-white/60 p-4 hover:border-tide"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{r.name}</p>
                  {r.isMember && (
                    <span className="shrink-0 rounded-full bg-fern px-2.5 py-0.5 text-xs font-semibold text-white">
                      {memberBadge}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </p>
                {r.blurb && <p className="mt-2 text-sm text-ink-soft">{r.blurb}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
