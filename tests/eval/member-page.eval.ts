// Live eval: real model, real page snapshot. NOT run by `npm test`.
//
//   EVAL_DIR=<folder with page.html + expected.json> ANTHROPIC_API_KEY=... \
//   [EVAL_RUNS=3] [MEMBER_EVENTS_MODEL=...] npm run eval:member-page
//
// Skips (does not fail) when ANTHROPIC_API_KEY or EVAL_DIR is unset.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractPageEvents, MODEL, type DraftEvent } from "@/lib/events/extract-page-events";
import { extractImages, extractLinks, htmlToText } from "@/lib/events/member-page-fetch";

interface Expected {
  id: string;
  titleHas?: string[];
  titleAnyOf?: string[];
  date?: string;
  time?: string | null;
  endTime?: string | null;
  repeat?: string | null;
  ticketUrl?: string | null;
  /** The chosen imageUrl must END WITH one of these file names. */
  artworkAnyOf?: string[];
}
interface ExpectedFile {
  today: string;
  /** Where the snapshot came from: the base url for its relative links and images. */
  source: string;
  events: Expected[];
  mustNotAppear?: { titleHas: string[]; date?: string }[];
}

const dir = process.env.EVAL_DIR;
const runs = Number(process.env.EVAL_RUNS) || 3;
const model = process.env.MEMBER_EVENTS_MODEL || MODEL;

const hasAll = (title: string, words: string[]) => words.every((w) => title.includes(w.toLowerCase()));
const hasAny = (title: string, words: string[]) => words.some((w) => title.includes(w.toLowerCase()));
const timeOf = (e: DraftEvent) => (e.timeMissing ? null : e.start.slice(11, 16));

function matches(x: DraftEvent, e: Expected): boolean {
  const title = x.title.toLowerCase();
  const byTitle =
    (!!e.titleHas?.length && hasAll(title, e.titleHas)) || (!!e.titleAnyOf?.length && hasAny(title, e.titleAnyOf));
  if (!byTitle) return false;
  return e.repeat ? x.rrule === e.repeat : !x.rrule && x.start.slice(0, 10) === e.date;
}

function forbidden(x: DraftEvent, f: { titleHas: string[]; date?: string }): boolean {
  return hasAll(x.title.toLowerCase(), f.titleHas) && (!f.date || x.start.slice(0, 10) === f.date);
}

function score(found: DraftEvent[], expected: ExpectedFile, n: number) {
  const used = new Set<number>();
  let got = 0;
  let total = 0;
  const rows: string[] = [];
  for (const e of expected.events) {
    const i = found.findIndex((x, k) => !used.has(k) && matches(x, e));
    const x = i >= 0 ? found[i] : undefined;
    if (i >= 0) used.add(i);
    const checks: [string, boolean][] = [["found", !!x]];
    checks.push(["time", !!x && timeOf(x) === (e.time ?? null)]);
    if (e.endTime) checks.push(["end", !!x && x.end?.slice(11, 16) === e.endTime]);
    checks.push(["ticket", !!x && (x.ticketUrl ?? null) === (e.ticketUrl ?? null)]);
    if (e.artworkAnyOf?.length) {
      const img = x?.imageUrl ? x.imageUrl.split(/[?#]/)[0].toLowerCase() : "";
      checks.push(["art", !!img && e.artworkAnyOf.some((f) => img.endsWith(f.toLowerCase()))]);
    }
    total += checks.length;
    got += checks.filter(([, ok]) => ok).length;
    rows.push(`  ${e.id.padEnd(24)} ${checks.map(([k, ok]) => `${k}:${ok ? "ok" : "NO"}`).join("  ")}`);
  }
  const forb = found.filter((x) => expected.mustNotAppear?.some((f) => forbidden(x, f))).length;
  const extras = found.filter((x, k) => !used.has(k) && !expected.mustNotAppear?.some((f) => forbidden(x, f)));
  console.log(`\nRun ${n} (${model})\n${rows.join("\n")}`);
  for (const x of extras) console.log(`  extra: ${x.title} ${x.rrule ?? x.start}`);
  console.log(`SCORE ${got}/${total} fields, extras ${extras.length}, forbidden ${forb}`);
}

describe.skipIf(!process.env.ANTHROPIC_API_KEY || !dir)("member page extraction (live)", () => {
  it(`extracts and scores ${runs} run(s)`, async () => {
    const root = dir as string;
    const html = readFileSync(path.join(root, "page.html"), "utf8");
    const expected = JSON.parse(readFileSync(path.join(root, "expected.json"), "utf8")) as ExpectedFile;
    const text = htmlToText(html, expected.source);
    const links = extractLinks(html, expected.source);
    const images = extractImages(html, expected.source);
    mkdirSync(path.join(root, "runs"), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    for (let n = 1; n <= runs; n++) {
      const r = await extractPageEvents(text, { today: expected.today, links, images });
      writeFileSync(
        path.join(root, "runs", `${model.replace(/[^\w.-]/g, "_")}-${stamp}-${n}.json`),
        JSON.stringify(r, null, 2),
      );
      expect(r.ok, `extraction failed: ${r.ok ? "" : r.reason}`).toBe(true);
      if (r.ok) score(r.events, expected, n);
    }
  });
});
