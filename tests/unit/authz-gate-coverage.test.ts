// Static gate-coverage guard (E06): "did every admin route gate itself?"
// becomes a CI failure instead of a manual audit.
//
// There is no middleware.ts. Every src/app/api/admin/** and
// src/app/api/portal/** handler is responsible for calling its own gate, and
// before E06 that convention was enforced by nothing but review — the app had
// ~12 divergent hand-rolled copies of the same admin check, one of which
// answered 403 where every other answered 401. This test reads the route files
// off disk and asserts two things about each: it imports from "@/lib/auth",
// and it actually references one of the shared gates. It also asserts that no
// file under src/app/ declares a gate of its own, so a future "just inline it
// here" copy fails CI at the moment it is written.
//
// Static analysis, deliberately: tests/server/admin-walk.test.ts is the
// runtime counterpart that proves the gates FIRE (it needs a live server), and
// this one proves they are WIRED. A route could pass the runtime walk for the
// wrong reason — a handler that throws, or 404s before reaching its gate,
// refuses an unauthenticated caller without being gated at all. Reading the
// source catches that; probing the endpoint does not.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC_APP = path.join(REPO_ROOT, "src", "app");

/** The barrel every gated route imports from. */
const AUTH_MODULE = "@/lib/auth";

/** Any one of these proves the file consults the shared auth layer. */
const GATES = ["requireRole", "requireAdmin", "requireUser", "requireCan", "getSessionUser"];

/** Route namespaces where self-gating is mandatory. */
const GATED_GLOBS = ["api/admin/**/route.ts", "api/portal/**/route.ts"];

/**
 * Tripwire floor. The whole test is vacuous if the glob silently matches
 * nothing (a moved directory, a changed extension, a bad cwd), so pin a
 * minimum well under today's count — this catches "0 files" without
 * failing every time a route is legitimately added or removed.
 */
const MIN_ROUTE_FILES = 15;

function gatedRouteFiles(): string[] {
  return fg.sync(GATED_GLOBS, { cwd: SRC_APP, absolute: true }).sort();
}

function rel(absFile: string): string {
  return path.relative(REPO_ROOT, absFile).replace(/\\/g, "/");
}

const routeFiles = gatedRouteFiles();

describe("every admin/portal route wires itself to the shared auth gate", () => {
  it(`finds at least ${MIN_ROUTE_FILES} route files to check (glob tripwire)`, () => {
    expect(
      routeFiles.length,
      `Matched ${routeFiles.length} route files under ${SRC_APP} — the glob is probably broken, ` +
        "which would make every assertion below pass vacuously.",
    ).toBeGreaterThanOrEqual(MIN_ROUTE_FILES);
  });

  it.each(routeFiles.map((f) => [rel(f), f] as const))("%s gates itself", (label, file) => {
    const source = readFileSync(file, "utf8");

    expect(
      source.includes(AUTH_MODULE),
      `${label} does not import from "${AUTH_MODULE}" — every route in this namespace must gate itself.`,
    ).toBe(true);

    const used = GATES.filter((g) => source.includes(g));
    expect(
      used,
      `${label} imports "${AUTH_MODULE}" but references none of: ${GATES.join(", ")}. ` +
        "Importing the module is not gating — call one of the gates.",
    ).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Per-HANDLER coverage.
//
// The file-level check above is not enough, and it is worth being precise
// about why: a route file exporting GET/POST/DELETE where exactly ONE handler
// forgets its gate still "imports @/lib/auth" and still "references
// requireRole" — because its siblings do. The file passes; the hole is open.
// (Verified by deleting a gate call from a real route: the file-level
// assertions stayed green.)
//
// So assert it per exported handler, which is the granularity the bug actually
// lives at.
// ---------------------------------------------------------------------------

type Handler = { method: string; body: string };

/**
 * Split a route module into its exported HTTP handlers.
 *
 * Deliberately a regex and not a TS parse: this is a tripwire that must keep
 * working with no toolchain of its own, and route files in this repo are
 * uniformly `export async function GET(...) { ... }` at top level. Each body
 * runs to the next top-level `export`, or to EOF.
 */
function handlersOf(source: string): Handler[] {
  const re = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm;
  const starts: { method: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) starts.push({ method: m[1], index: m.index });

  return starts.map((s, i) => {
    const nextExport = source.slice(s.index + 1).search(/^export\s/m);
    const end =
      i + 1 < starts.length
        ? starts[i + 1].index
        : nextExport >= 0
          ? s.index + 1 + nextExport
          : source.length;
    return { method: s.method, body: source.slice(s.index, end) };
  });
}

/**
 * Handlers that legitimately answer without a session, each with the reason.
 * An entry here is a deliberate, reviewed decision — not a way to quiet the
 * test. Empty today: every admin/portal handler gates.
 */
const PUBLIC_HANDLERS: Record<string, string> = {};

describe("every exported handler calls a gate (not just its file)", () => {
  const cases = routeFiles.flatMap((file) =>
    handlersOf(readFileSync(file, "utf8")).map(
      (h) => [`${h.method} ${rel(file)}`, h] as const,
    ),
  );

  it("found handlers to check (tripwire against a broken parse)", () => {
    expect(
      cases.length,
      "Parsed zero exported handlers — handlersOf() is broken and every case below is vacuous.",
    ).toBeGreaterThanOrEqual(MIN_ROUTE_FILES);
  });

  it.each(cases)("%s calls a gate", (label, handler) => {
    if (PUBLIC_HANDLERS[label]) return;
    const used = GATES.filter((g) => handler.body.includes(g));
    expect(
      used,
      `${label} does not call any of: ${GATES.join(", ")}.\n` +
        "Another handler in the same file gating itself does NOT cover this one. " +
        "Call a gate here, or add an entry to PUBLIC_HANDLERS with the reason.",
    ).not.toHaveLength(0);
  });
});

describe("no route re-declares its own gate", () => {
  // The E06 regression this exists to prevent: someone needs a check, doesn't
  // find the import, and writes `async function requireAdmin()` locally. That
  // copy drifts from the shared contract the moment either side changes.
  // src/lib/auth/ is where the real one lives and is excluded by construction.
  it("src/app/ declares no local requireAdmin/requireRole/requireUser/requireCan", () => {
    const declaration = /\bfunction\s+(requireAdmin|requireRole|requireUser|requireCan)\b/;
    const offenders: string[] = [];

    for (const file of fg.sync("**/*.{ts,tsx}", { cwd: SRC_APP, absolute: true })) {
      const source = readFileSync(file, "utf8");
      const line = source.split("\n").findIndex((l) => declaration.test(l));
      if (line >= 0) {
        offenders.push(`${rel(file)}:${line + 1} — import the gate from "${AUTH_MODULE}" instead`);
      }
    }

    expect(offenders, `local gate declaration(s) found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
