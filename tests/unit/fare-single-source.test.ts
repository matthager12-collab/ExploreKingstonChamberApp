// E14 × E27 — a ferry fare figure is written in exactly one place.
//
// THE BUG THIS EXISTS TO PREVENT. E27 moved the fares out of hardcoded JSX and
// into the admin-editable `fares` record so a Chamber staffer could fix the
// October WSF adjustment without a deploy. That only works if no page carries
// its own copy of a figure. Between E27 and this change, two did:
// `en.walkOn` and `es.walkOn` in the E14 safety dictionary, feeding /simple and
// /es — the two pages written for the readers least able to notice a stale
// number, and the two pages nobody thinks to check after editing /admin.
// docs/OPERATIONS.md §6 and §14.1 carried that split as a standing warning.
// A warning in a runbook is not a guarantee; this file is.
//
// TWO TIERS, deliberately different in strictness:
//
//   1. The walk-on round-trip fare — the figure /simple, /es and /ferry all
//      quote inside a sentence — must appear in the seed and NOWHERE else.
//      No allow-list. This is the one the epic fixed.
//
//   2. Every other fare figure gets an inventory guard: hand-written copies
//      must be on KNOWN_DUPLICATES below, with a reason. Those are pre-existing
//      /ferry prose from before E27, out of scope here — but listing them
//      keeps the count from growing quietly, and gives whoever picks them up a
//      complete work-list instead of a grep.
//
// CAVEAT: whole-line comments are blanked before scanning (the idiom
// tests/unit/no-fs-store-writes.test.ts uses), so prose ABOUT a fare does not
// trip the guard. A figure in a TRAILING comment (`const x = 1; // was $27`)
// still counts as a violation — move it to its own line or drop the figure.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FERRY_FARES,
  WALK_ON_ROUND_TRIP_KEY,
  walkOnRoundTripFare,
  type FareRow,
  type FerryFares,
} from "@/lib/data/ferry-info";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
const REPO_ROOT = path.join(SRC_ROOT, "..");

/** The one place a fare figure is allowed to be written by hand. */
const SEED_FILE = "src/lib/data/ferry-info.ts";

/**
 * Hand-written fare figures that are NOT the walk-on round trip, each with the
 * reason it still exists. Adding an entry is a deliberate act with a reviewer;
 * the point of the list is that it can only grow on purpose.
 */
const KNOWN_DUPLICATES: { file: string; amount: string; why: string }[] = [
  {
    file: "src/app/(site)/ferry/page.tsx",
    amount: "$27.00",
    why: "Pre-E27 prose: the drive-on summary Badge ('$27 each way'). Same class of bug as the walk-on fare, out of scope here — it needs its own stable row key on the 'Car and driver' row.",
  },
  {
    file: "src/app/(site)/ferry/page.tsx",
    amount: "$2.00",
    why: "Pre-E27 prose: the fast-ferry section TITLE ('The $2 boat to Seattle') and the Pier 50 card. Driving a title from an editable free-text amount would let an admin publish 'The Free boat to Seattle' — that needs an editorial decision, not just a lookup.",
  },
  {
    file: "src/app/(site)/ferry/page.tsx",
    amount: "$13.00",
    why: "Pre-E27 prose: the 'Coming from Seattle without a car' card, alongside the $2 return leg.",
  },
  {
    file: "src/lib/kitsap.ts",
    amount: "$2.00",
    why: "FAST_FERRY_FACTS is a separate Kitsap Transit data module that predates the fares record and is not admin-editable; its fare sentence duplicates the fastFerry rows.",
  },
  {
    file: "src/lib/kitsap.ts",
    amount: "$13.00",
    why: "Same FAST_FERRY_FACTS sentence as above.",
  },
];

/* --------------------------------- scanning -------------------------------- */

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // __tests__ lives inside src/; its fixtures quote figures on purpose.
      if (entry.name !== "__tests__") out.push(...sourceFilesUnder(p));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(p);
    }
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/**
 * How a given `amount` could be written in prose. "$27.00" is also written
 * "$27", so both spellings count as the same figure; "Free" and
 * "$27.00 + $11.35/passenger" are not single figures and yield nothing —
 * those are shapes only the fare TABLE renders, never a sentence.
 */
function moneyVariants(amount: string): string[] {
  const m = /^\$(\d{1,3}(?:,\d{3})*)(?:\.(\d{2}))?$/.exec(amount.trim());
  if (!m) return [];
  const [, dollars, cents] = m;
  const variants = [`$${dollars}${cents ? `.${cents}` : ""}`];
  if (cents === "00") variants.push(`$${dollars}`);
  return variants;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Hit {
  file: string;
  line: number;
  /** The seed AMOUNT this matched, not the spelling found — "$27.00" and
   *  "$27" are the same fare, and an allow-list keyed on characters instead
   *  of on the fare goes stale the moment prose writes it the other way. */
  amount: string;
  text: string;
}

/** Every place any of `amounts` is written by hand in src/, seed file excluded. */
function findHardcoded(amounts: string[]): Hit[] {
  const patterns = amounts.map((amount) => ({
    amount,
    res: moneyVariants(amount).map((v) => new RegExp(`${escapeRe(v)}\\b`)),
  }));
  const hits: Hit[] = [];

  for (const file of sourceFilesUnder(SRC_ROOT)) {
    const rel = path.relative(REPO_ROOT, file);
    if (rel === SEED_FILE) continue;

    const lines = readFileSync(file, "utf8")
      .split("\n")
      .map((l) => (isCommentLine(l) ? "" : l));

    lines.forEach((line, i) => {
      for (const { amount, res } of patterns) {
        if (res.some((re) => re.test(line))) {
          hits.push({ file: rel, line: i + 1, amount, text: line.trim() });
        }
      }
    });
  }
  return hits;
}

/** Every fare amount in the seed, by group. */
function allSeedRows(): FareRow[] {
  const f = FERRY_FARES as unknown as FerryFares;
  return [...f.walkOn, ...f.drive, ...f.fastFerry];
}

/* ---------------------------------- tests ---------------------------------- */

describe("the walk-on round-trip fare is single-sourced", () => {
  const seedAmount = walkOnRoundTripFare(FERRY_FARES as unknown as FerryFares);

  it("is resolvable from the seed at all", () => {
    // If this fails, everything below is vacuously true — the guard would be
    // scanning for nothing and reporting success.
    expect(
      seedAmount,
      `no row keyed "${WALK_ON_ROUND_TRIP_KEY}" with a single money figure — /simple, /es and /ferry would all quote the fallback wording instead of a fare`,
    ).toMatch(/^\$\d/);
  });

  it("appears in src/ only in the seed record", () => {
    const hits = findHardcoded([seedAmount!]);
    expect(
      hits.map((h) => `${h.file}:${h.line}  ${h.text}`),
      [
        `The walk-on round-trip fare (${seedAmount}) is written by hand outside ${SEED_FILE}.`,
        "",
        "It is admin-editable at /admin/ferry-info → Fares, so a second copy keeps",
        "publishing last year's number after the Chamber fixes it — the exact split",
        "docs/OPERATIONS.md §14.1 used to warn about. Use the record instead:",
        "",
        "  · in a page:        walkOnRoundTripFare(ferryInfo.fares)",
        "  · in safety copy:   the {walkOnRoundTrip} token, filled via safetyValues()",
        "",
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("every other fare figure is either single-sourced or documented", () => {
  it("has no undocumented hand-written copies", () => {
    const walkOnRoundTrip = walkOnRoundTripFare(FERRY_FARES as unknown as FerryFares);
    const others = allSeedRows()
      .filter((r) => r.key !== WALK_ON_ROUND_TRIP_KEY)
      .map((r) => r.amount)
      // The walk-on figure has its own, stricter test above; the drive-on
      // "Each extra passenger" row happens to carry the same amount.
      .filter((amount) => amount !== walkOnRoundTrip)
      .filter((amount) => moneyVariants(amount).length > 0);

    const allowed = new Set(KNOWN_DUPLICATES.map((d) => `${d.file}|${d.amount}`));
    const undocumented = findHardcoded([...new Set(others)])
      .filter((h) => !allowed.has(`${h.file}|${h.amount}`))
      .map((h) => `${h.file}:${h.line}  (${h.amount})  ${h.text}`);

    expect(
      undocumented,
      [
        "A fare figure is hardcoded somewhere new. Prefer driving it from the",
        "fares record; if it genuinely cannot be, add it to KNOWN_DUPLICATES in",
        "this file with the reason, so the October chore has a complete work-list:",
        "",
      ].join("\n"),
    ).toEqual([]);
  });

  it("lists no stale entries — every documented duplicate is still real", () => {
    // An allow-list that outlives its violations quietly re-permits the bug.
    const stale = KNOWN_DUPLICATES.filter(
      (d) => findHardcoded([d.amount]).find((h) => h.file === d.file) === undefined,
    ).map((d) => `${d.file} no longer hardcodes ${d.amount} — drop the entry`);
    expect(stale).toEqual([]);
  });
});

describe("walkOnRoundTripFare() — how the sentence finds its number", () => {
  const fares = (walkOn: FareRow[]): FerryFares =>
    ({ ...(FERRY_FARES as unknown as FerryFares), walkOn });

  const keyed = (over: Partial<FareRow> = {}): FareRow => ({
    key: WALK_ON_ROUND_TRIP_KEY,
    label: "Round trip on foot",
    amount: "$11.35",
    ...over,
  });

  it("reads the amount off the keyed row", () => {
    expect(walkOnRoundTripFare(fares([keyed()]))).toBe("$11.35");
  });

  it("still finds it after an operator renames the label", () => {
    // The reason this is a key and not a label match: rewording a label is a
    // thing the Chamber is entitled to do, and /simple must survive it.
    expect(walkOnRoundTripFare(fares([keyed({ label: "Walking on, both ways" })]))).toBe("$11.35");
  });

  it("still finds it after an operator reorders the rows", () => {
    const rows = [{ label: "Kids 18 and under", amount: "Free" }, keyed()];
    expect(walkOnRoundTripFare(fares(rows))).toBe("$11.35");
  });

  it("returns null when the row was deleted, rather than a number nobody entered", () => {
    expect(walkOnRoundTripFare(fares([{ label: "Kids 18 and under", amount: "Free" }]))).toBeNull();
  });

  it("returns null for an amount that is not a single figure", () => {
    // All legitimate table entries; none of them can be dropped into
    // "a round trip on foot costs ___, and you pay it once."
    for (const amount of ["Free", "Free leaving Kingston", "$27.00 + $11.35/passenger", "see WSF"]) {
      expect(walkOnRoundTripFare(fares([keyed({ amount })])), amount).toBeNull();
    }
  });

  it("accepts the figure shapes a fare can legitimately take", () => {
    for (const amount of ["$11.35", "$27", "$1,240.00"]) {
      expect(walkOnRoundTripFare(fares([keyed({ amount })])), amount).toBe(amount);
    }
  });

  it("tolerates whitespace an operator leaves in the field", () => {
    expect(walkOnRoundTripFare(fares([keyed({ amount: "  $11.35 " })]))).toBe("$11.35");
  });
});
