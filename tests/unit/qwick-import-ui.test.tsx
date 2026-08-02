// @vitest-environment jsdom

// E17 /admin/import/qwick — the two review findings this screen shipped with.
//
// (1) CONTRAST. `text-ink-soft` (#6b7683) is AA-legal on a white Card (4.62:1)
//     and AA-ILLEGAL on the page fill --color-shell (4.48:1). The manager had
//     one paragraph — the "Run a preview first" hint — as a direct child of
//     <Section>, i.e. on shell. The zero-tolerance axe suite structurally
//     cannot catch that pair: <body> carries a background-image, so axe reports
//     "incomplete" for contrast rather than a violation. So this file MEASURES
//     the ratio instead of asking axe: it renders the manager through every
//     state, resolves each text node's real backdrop by compositing the
//     Tailwind bg-* classes up the ancestor chain, and fails anything under AA.
//     Being generic, it also covers the next soft token someone drops on shell.
//
// (2) APPLY-CONFIRMATION HONESTY. The server deliberately RE-PLANS on apply
//     (that is what stops a stale preview being replayed against a database
//     that moved), so the confirmation may not present the preview's counts as
//     what will run, and the result panel must be the authoritative one.
//
// Admin-only surface: plain strings, no copy registry (bijection test would
// otherwise fail on orphan keys).

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { QwickImportManager } from "@/app/(site)/admin/import/qwick/manager";

// jsdom rewrites import.meta.url to an http URL, so the file-URL trick the
// node-environment suites use is unavailable here. Vitest always runs from the
// repo root (vitest.config.ts lives there), so cwd is the equivalent anchor.
const REPO_ROOT = process.cwd();
const SRC_ROOT = path.join(REPO_ROOT, "src");
const QWICK_UI_DIR = path.join(SRC_ROOT, "app", "(site)", "admin", "import", "qwick");

/* ---------------------------------------------------------------------------
 * Contrast machinery. Same WCAG arithmetic as
 * tests/unit/a11y-static-invariants.test.ts, but applied to a RENDERED tree
 * rather than to single source lines — which is the only way to know what a
 * muted node is actually sitting on, since the failing pair here is split
 * across two elements (the text on the child, the background on nobody).
 * ------------------------------------------------------------------------ */

type Rgb = [number, number, number];

/** Brand palette, read from the single source of truth. */
function readPalette(): Record<string, string> {
  const css = readFileSync(path.join(SRC_ROOT, "app", "globals.css"), "utf8");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  // Tailwind ships these two outside the @theme block; both are used here.
  out.white = "#ffffff";
  out.black = "#000000";
  return out;
}

const PALETTE = readPalette();
const TOKENS = Object.keys(PALETTE)
  // Longest first so `ink-soft` is matched before `ink`.
  .sort((a, b) => b.length - a.length);

function toRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb;
}

/** `bg-tide/5` → { token: "tide", alpha: 0.05 }; `text-sm` → null. */
function paletteClass(
  classes: string[],
  prefix: "bg" | "text",
): { token: string; alpha: number } | null {
  for (const cls of classes) {
    for (const token of TOKENS) {
      if (cls === `${prefix}-${token}`) return { token, alpha: 1 };
      const m = cls.match(
        new RegExp(`^${prefix}-${token.replace(/-/g, "\\-")}\\/(\\d{1,3})$`),
      );
      if (m) return { token, alpha: Number(m[1]) / 100 };
    }
  }
  return null;
}

function classesOf(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * The page fill every unstyled node ultimately sits on. Not white: <body> is
 * --color-shell (globals.css), and that 4-value gap is exactly the bug — the
 * same token passes on white and fails on shell.
 */
const PAGE_FILL: Rgb = toRgb(PALETTE.shell);

/** Resolved backdrop for `el` INCLUDING its own bg-* class, composited up. */
function backdropOf(el: Element | null): Rgb {
  if (!el || el === document.documentElement || el.tagName === "BODY") return PAGE_FILL;
  const parent = backdropOf(el.parentElement);
  const own = paletteClass(classesOf(el), "bg");
  return own ? composite(toRgb(PALETTE[own.token]), own.alpha, parent) : parent;
}

/** Nearest text-* palette class on el-or-ancestor; default is body ink. */
function inkOf(el: Element | null): { token: string; alpha: number } {
  for (let n: Element | null = el; n && n.tagName !== "BODY"; n = n.parentElement) {
    const own = paletteClass(classesOf(n), "text");
    if (own) return own;
  }
  return { token: "ink", alpha: 1 };
}

function describeEl(el: Element): string {
  return `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;
}

const AA_NORMAL = 4.5;

/**
 * Every element with its own visible text, measured. Returns human-readable
 * violation lines. Elements whose only children are other elements are skipped
 * — their text is attributed to the descendant that owns it.
 */
function contrastViolations(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (ownText === "") continue;

    const backdrop = backdropOf(el);
    const ink = inkOf(el);
    const fg = composite(toRgb(PALETTE[ink.token]), ink.alpha, backdrop);
    const ratio = contrast(fg, backdrop);
    if (ratio < AA_NORMAL) {
      out.push(
        `${ratio.toFixed(3)}:1  text-${ink.token} on #${backdrop
          .map((c) => c.toString(16).padStart(2, "0"))
          .join("")}  ${describeEl(el)}  “${ownText.slice(0, 60)}”`,
      );
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Fixtures — one entry in every bucket, so a single render exercises every
 * muted node in the file (the Bucket <details> keeps closed children in the
 * DOM, so the scan sees them either way).
 * ------------------------------------------------------------------------ */

const PLAN = {
  created: [
    {
      externalId: "qw-1",
      record: {
        id: "kingston-kayak-rentals",
        name: "Kingston Kayak Rentals",
        category: "Recreation",
        phone: "360-555-0100",
        website: "https://example.test",
        // Provenance only — the UI must name the field and never the value.
        sourceImages: ["opaque-provenance-blob"],
      },
    },
  ],
  updated: [
    {
      externalId: "qw-2",
      store: "directory",
      id: "drift-inn",
      status: "draft",
      diffs: [{ field: "phone", local: "360-555-0001", upstream: "360-555-0002" }],
    },
  ],
  unchanged: [{ externalId: "qw-3", store: "directory", id: "same-old" }],
  matched: [
    {
      externalId: "qw-4",
      store: "restaurants",
      id: "jaime-les-crepes",
      name: "J'aime Les Crêpes",
      aliasNew: true,
      diffs: [],
    },
  ],
  quarantined: [
    { externalId: "qw-5", name: "Ambiguous Co", reason: "two candidates", candidateIds: ["a", "b"] },
  ],
  deletedUpstream: [{ externalId: "qw-6", store: "directory", id: "gone-upstream" }],
};

const PREVIEW_STATS = {
  created: 1,
  updated: 1,
  unchanged: 1,
  matched: 1,
  quarantined: 1,
  deletedUpstream: 1,
};
/** Deliberately DIFFERENT from the preview's: the server re-plans on apply. */
const APPLIED_STATS = {
  created: 2,
  updated: 0,
  unchanged: 1,
  matched: 1,
  quarantined: 1,
  deletedUpstream: 1,
};

const RUNS = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    mode: "apply" as const,
    startedAt: "2026-08-01T17:00:00.000Z",
    finishedAt: "2026-08-01T17:00:04.000Z",
    runBy: "admin@example.test",
    stats: APPLIED_STATS,
  },
];

function jsonOk(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

/** POST preview → plan, POST apply → applied stats, GET → history. */
function installFetch() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method !== "POST") return jsonOk({ runs: RUNS });
    const body = JSON.parse(String(init.body)) as { mode: string };
    if (body.mode === "preview") {
      return jsonOk({ runId: "aaaaaaaa-bbbb", stats: PREVIEW_STATS, plan: PLAN });
    }
    return jsonOk({ runId: "cccccccc-dddd", stats: APPLIED_STATS });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const previewButton = () => screen.getByRole("button", { name: "Preview import" });
const applyButton = () => screen.getByRole("button", { name: "Apply import" });

beforeEach(() => {
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------- finding 1 ------------------------------- */

describe("contrast: no muted text on the page fill", () => {
  it("the idle state (the regression) clears AA", async () => {
    const { container } = render(<QwickImportManager initialRuns={[]} />);
    // The exact node the review flagged: a direct child of <Section>, so its
    // backdrop is --color-shell, where text-ink-soft is 4.48:1.
    expect(screen.getByText(/Run a preview first/)).toBeInTheDocument();
    expect(contrastViolations(container as HTMLElement)).toEqual([]);
  });

  it("the previewed, applied, and error states all clear AA", async () => {
    const { container } = render(<QwickImportManager initialRuns={RUNS} />);

    // Preview → the whole bucketed plan plus the Apply card.
    fireEvent.click(previewButton());
    await screen.findByText(/Planned now/);
    expect(contrastViolations(container as HTMLElement)).toEqual([]);

    // Apply → the result panel (bg-shell inside a Card).
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(applyButton());
    await screen.findByText(/what actually ran/);
    expect(contrastViolations(container as HTMLElement)).toEqual([]);

    // Stale-preview warnings (two coral notes, both on shell).
    fireEvent.change(screen.getByLabelText(/Saved export JSON/), {
      target: { value: "[]" },
    });
    expect(screen.getAllByText(/export changed since|Locked:/).length).toBeGreaterThan(0);
    expect(contrastViolations(container as HTMLElement)).toEqual([]);

    // Local error path (invalid JSON never reaches the server).
    fireEvent.change(screen.getByLabelText(/Saved export JSON/), {
      target: { value: "{not json" },
    });
    fireEvent.click(previewButton());
    await screen.findByRole("alert");
    expect(contrastViolations(container as HTMLElement)).toEqual([]);
  });

  it("the scanner would have failed the original markup (positive control)", () => {
    // Guards the guard: if the backdrop resolution ever silently degrades to
    // white, every ink-soft node passes and this file stops meaning anything.
    document.body.innerHTML =
      '<section class="mx-auto max-w-5xl px-4 py-8">' +
      '<p class="text-sm text-ink-soft">Run a preview first — Apply unlocks after it.</p>' +
      "</section>";
    const violations = contrastViolations(document.body);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/text-ink-soft/);
    // …and the same token inside a Card must still pass, or the scanner is
    // just banning ink-soft rather than measuring it.
    document.body.innerHTML =
      '<div class="rounded-2xl border border-sand bg-white p-5">' +
      '<p class="text-sm text-ink-soft">No import runs recorded yet.</p>' +
      "</div>";
    expect(contrastViolations(document.body)).toEqual([]);
    document.body.innerHTML = "";
  });

  it("the server half of the screen carries no soft token on the page fill", () => {
    // page.tsx renders only <PageHeader> (already repaired in E14) plus the
    // manager. Any muted class added straight into it would land on shell.
    const pageSource = readFileSync(path.join(QWICK_UI_DIR, "page.tsx"), "utf8");
    expect(pageSource).not.toMatch(/text-ink-soft/);
  });
});

/* ------------------------------- finding 3 ------------------------------- */

describe("apply confirmation is honest about the server re-plan", () => {
  it("the checkbox says the server re-plans and the counts may differ", async () => {
    render(<QwickImportManager initialRuns={[]} />);
    fireEvent.click(previewButton());
    const label = (await screen.findByRole("checkbox")).closest("label");
    const text = label?.textContent ?? "";

    // It may still quote the preview (operators need the number) …
    expect(text).toMatch(/1 created/);
    // … but never as what WILL be written.
    expect(text).not.toMatch(/want to write it to the database/);
    expect(text).toMatch(/re-plans/i);
    expect(text).toMatch(/differ/i);
    // The moderation promise stays.
    expect(text).toMatch(/Nothing becomes public/);
  });

  it("the section heading states the re-plan too, not just 're-checks'", () => {
    render(<QwickImportManager initialRuns={[]} />);
    const subtitle = screen.getByText(/Applies the SAME export you previewed/);
    expect(subtitle.textContent).toMatch(/re-plans/i);
    expect(subtitle.textContent).toMatch(/can differ/i);
  });

  it("the preview summary is labelled an estimate, not a commitment", () => {
    render(<QwickImportManager initialRuns={[]} />);
    fireEvent.click(previewButton());
    return waitFor(() => {
      const line = screen.getByText(/Planned now/).closest("p");
      expect(line?.textContent).toMatch(/estimate, not a promise/);
    });
  });

  it("the result panel reports the APPLIED stats and marks them authoritative", async () => {
    render(<QwickImportManager initialRuns={[]} />);
    fireEvent.click(previewButton());
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(applyButton());

    const panel = (await screen.findByText(/what actually ran/)).closest("p");
    const text = panel?.textContent ?? "";
    // APPLIED_STATS, not PREVIEW_STATS — 2 created vs 1, and 0 updated so the
    // preview's "1 updated" must be absent.
    expect(text).toMatch(/2 created/);
    expect(text).not.toMatch(/1 updated/);
    expect(text).toMatch(/authoritative/i);
  });
});

/* --------------------------- preserved properties ------------------------- */

describe("properties this screen must not lose", () => {
  it("apply re-submits the same export payload and never a stored plan id", async () => {
    const fetchMock = installFetch();
    render(<QwickImportManager initialRuns={[]} />);
    fireEvent.change(screen.getByLabelText(/Saved export JSON/), {
      target: { value: '[{"id":"qw-1","name":"Kayak"}]' },
    });
    fireEvent.click(previewButton());
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(applyButton());
    await screen.findByText(/what actually ran/);

    const applyCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST" && String(init.body).includes('"apply"'),
    );
    const sent = JSON.parse(String(applyCall?.[1]?.body)) as Record<string, unknown>;
    expect(sent.mode).toBe("apply");
    expect(sent.export).toEqual([{ id: "qw-1", name: "Kayak" }]);
    expect(sent).not.toHaveProperty("runId");
    expect(sent).not.toHaveProperty("plan");
  });

  it("a created row's vendor image value is never rendered — only the field's existence", async () => {
    const { container } = render(<QwickImportManager initialRuns={[]} />);
    fireEvent.click(previewButton());
    await screen.findByText(/Planned now/);
    expect(container.textContent).toContain("vendor images kept as provenance");
    expect(container.textContent).not.toContain("opaque-provenance-blob");
  });
});
