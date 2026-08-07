"use client";

// Filters for the town calendar — type, date, and business.
//
// THE SHAPE, and why it looks like this: /events is an ISR page
// (`export const revalidate = 60`) and that is load-bearing, so the filters had
// to cost nothing on the server. The page renders every upcoming card on the
// server as it always did and hands them here as `children`; this component
// only decides WHICH indices to render and what headings to put above them.
//
// So: no search params (they would make the route dynamic and quietly kill
// revalidate — the /ferry trap, see src/lib/page-visibility.tsx), no fetch on
// filter change, and no card markup in the client bundle. Turning every filter
// off renders exactly the tree the server sent.
//
// `today` and `weekendDates` are PROPS, not computed here: the server already
// knows the Pacific date, and recomputing it on the client is how you get a
// hydration mismatch at midnight UTC.

import { useMemo, useState, type ReactNode } from "react";
import type { EventCategory } from "@/lib/types";
import { OTHER_BUSINESS_VALUE, type BusinessOption } from "@/lib/businesses";

/** One row of filterable facts, in the same order as `children`. */
export interface BrowseItem {
  id: string;
  category: EventCategory;
  /** Pacific calendar date, "2026-08-08". */
  dateKey: string;
  /** Business picker value when the organizer is on the Chamber's list,
   *  OTHER_BUSINESS_VALUE when it is a name we do not recognize, null when the
   *  event names no organizer at all. */
  business: string | null;
  /** What to show for an unmatched organizer, so "other" is not a dead end. */
  organizer: string;
}

const CATEGORY_LABEL: Record<EventCategory, string> = {
  festival: "Festival",
  market: "Market",
  music: "Music",
  community: "Community",
  charity: "Fundraiser",
  sports: "Sports",
  arts: "Arts",
};

type DateWindow = "any" | "weekend" | "month" | "30";

const DATE_LABEL: Record<DateWindow, string> = {
  any: "Any date",
  weekend: "This weekend",
  month: "This month",
  30: "Next 30 days",
};

const inputClass =
  "block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base sm:w-auto";

/** "2026-08" → "August 2026". UTC noon and an explicit UTC zone — the same
 *  construction the server used before this moved client-side, so the string
 *  is identical in the prerender and after hydration wherever the reader is. */
function monthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

/** `days` calendar days on from a "YYYY-MM-DD" key, as the same kind of key.
 *  Pure string→string via UTC noon, so no local-timezone drift. */
function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function EventsBrowser({
  items,
  businesses,
  today,
  weekendDates,
  children,
}: {
  items: BrowseItem[];
  businesses: BusinessOption[];
  today: string;
  weekendDates: string[];
  children: ReactNode[];
}) {
  const [category, setCategory] = useState<EventCategory | "any">("any");
  const [dateWindow, setDateWindow] = useState<DateWindow>("any");
  const [business, setBusiness] = useState<string>("any");

  // Only offer a filter value that would actually match something. A dropdown
  // of 300 Chamber members, 6 of whom have an event this month, is a worse
  // control than one listing the 6.
  const presentCategories = useMemo(() => {
    const seen = new Set(items.map((i) => i.category));
    return (Object.keys(CATEGORY_LABEL) as EventCategory[]).filter((c) => seen.has(c));
  }, [items]);

  const presentBusinesses = useMemo(() => {
    const seen = new Set(items.map((i) => i.business).filter(Boolean) as string[]);
    const onList = businesses.filter((b) => seen.has(b.value));
    return { onList, hasOther: seen.has(OTHER_BUSINESS_VALUE) };
  }, [items, businesses]);

  const windowEnd = useMemo(
    () => (dateWindow === "30" ? addDays(today, 30) : null),
    [dateWindow, today],
  );

  const visible = useMemo(() => {
    const weekend = new Set(weekendDates);
    const thisMonth = today.slice(0, 7);
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (category !== "any" && item.category !== category) return false;
        if (business !== "any" && item.business !== business) return false;
        if (dateWindow === "weekend" && !weekend.has(item.dateKey)) return false;
        if (dateWindow === "month" && item.dateKey.slice(0, 7) !== thisMonth) return false;
        if (windowEnd && item.dateKey > windowEnd) return false;
        return true;
      });
  }, [items, category, business, dateWindow, weekendDates, today, windowEnd]);

  const filtered = category !== "any" || business !== "any" || dateWindow !== "any";

  // Same grouping the page used before filters existed: a weekend shelf, then
  // one section per month. A group with nothing left in it does not render.
  const weekendGroup = useMemo(() => {
    const weekend = new Set(weekendDates);
    return visible.filter(({ item }) => weekend.has(item.dateKey));
  }, [visible, weekendDates]);

  const months = useMemo(() => {
    const byMonth = new Map<string, typeof visible>();
    for (const entry of visible) {
      const key = entry.item.dateKey.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), entry]);
    }
    return [...byMonth.entries()];
  }, [visible]);

  function clearAll() {
    setCategory("any");
    setDateWindow("any");
    setBusiness("any");
  }

  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pt-4">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-sand bg-white/60 p-4">
          <label className="text-sm font-medium text-sound-deep">
            <span className="block">Type</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EventCategory | "any")}
              className={inputClass}
            >
              <option value="any">All types</option>
              {presentCategories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-sound-deep">
            <span className="block">When</span>
            <select
              value={dateWindow}
              onChange={(e) => setDateWindow(e.target.value as DateWindow)}
              className={inputClass}
            >
              {(Object.keys(DATE_LABEL) as DateWindow[]).map((w) => (
                <option key={w} value={w}>
                  {DATE_LABEL[w]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-sound-deep">
            <span className="block">Business</span>
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
              className={inputClass}
            >
              <option value="any">All businesses</option>
              {presentBusinesses.onList.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
              {presentBusinesses.hasOther && (
                <option value={OTHER_BUSINESS_VALUE}>Other organizers</option>
              )}
            </select>
          </label>

          {filtered && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-tide"
            >
              Clear filters
            </button>
          )}
        </div>
        {filtered && (
          <p className="mt-2 text-sm text-ink-soft" role="status" aria-live="polite">
            {visible.length === 1 ? "1 event" : `${visible.length} events`} match
            {visible.length === 1 ? "es" : ""} your filters.
          </p>
        )}
      </section>

      {visible.length === 0 && (
        <section className="mx-auto max-w-5xl px-4 py-8">
          <div className="rounded-xl border border-sand bg-white p-6">
            <p className="font-semibold text-sound-deep">
              Nothing on the calendar matches those filters.
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              Try widening the date range, or{" "}
              <button
                type="button"
                onClick={clearAll}
                className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
              >
                clear the filters
              </button>{" "}
              to see everything coming up.
            </p>
          </div>
        </section>
      )}

      {weekendGroup.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 py-8 scroll-mt-24">
          <h2 className="text-2xl font-semibold text-sound-deep sm:text-3xl">This weekend</h2>
          <p className="mt-1 mb-2 text-ink">
            Coming up in the next few days — no planning required.
          </p>
          <div className="mt-5 grid gap-4">
            {weekendGroup.map(({ item, index }) => (
              <div key={item.id}>{children[index]}</div>
            ))}
          </div>
        </section>
      )}

      {months.map(([monthKey, entries]) => (
        <section key={monthKey} className="mx-auto max-w-5xl px-4 py-8 scroll-mt-24">
          <h2 className="text-2xl font-semibold text-sound-deep sm:text-3xl">
            {monthLabel(monthKey)}
          </h2>
          <div className="mt-5 grid gap-4">
            {entries.map(({ item, index }) => (
              <div key={item.id}>{children[index]}</div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
