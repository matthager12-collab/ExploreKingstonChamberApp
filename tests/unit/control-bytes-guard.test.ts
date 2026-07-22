import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Guards scripts/check-control-bytes.mjs, which fails CI when a tracked text
// file carries a raw control byte. That defect is invisible by construction —
// `file` calls the source binary, so grep skips it and reports nothing rather
// than no-match — and it reached main twice before the guard existed.
//
// The point of THIS suite is that a guard which silently stops detecting is
// indistinguishable from one that works: CI stays green either way. So we assert
// it actually exits 1 on a planted byte, not merely that it exits 0 today.
//
// Real temp git repos, because the script enumerates work via `git ls-files`.

const GUARD = path.resolve(__dirname, "../../scripts/check-control-bytes.mjs");
const NUL = String.fromCharCode(0); // never write the raw byte into this source
const ESCAPE = `${String.fromCharCode(92)}u0000`; // the 6 chars: backslash u 0 0 0 0

let root: string;

/** A throwaway git repo with `files` staged; returns its path. */
async function repoWith(files: Record<string, string | Uint8Array>): Promise<string> {
  const dir = await mkdtemp(path.join(root, "repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  // Staged is enough — the script reads the index via `git ls-files`.
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function runGuard(cwd: string) {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "control-bytes-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("check-control-bytes guard", () => {
  it("fails, and points at the byte, when a tracked source file holds a raw NUL", async () => {
    const dir = await repoWith({
      "src/keys.ts": `export const sep = \`a${NUL}b\`;\n`,
    });
    const { status, out } = runGuard(dir);

    expect(status).toBe(1);
    expect(out).toContain("FAILED");
    // Line 1, and the column of the NUL itself — actionable without a hex dump.
    // `export const sep = \`a` is 21 characters, so the byte sits at column 22.
    expect(out).toContain("src/keys.ts:1:22  0x00 NUL");
  });

  it("passes once the raw byte is written as the equivalent escape", async () => {
    const dir = await repoWith({
      "src/keys.ts": `export const sep = \`a${ESCAPE}b\`;\n`,
    });
    const { status, out } = runGuard(dir);

    expect(status).toBe(0);
    expect(out).toContain("OK");
  });

  it("reports the overflow instead of silently truncating a long list", async () => {
    // Seven NULs against a per-file cap of five: the two extra must be counted,
    // not dropped. Hiding offenders from the fixer is this bug class all over.
    const dir = await repoWith({
      "src/many.ts": `const x = "${NUL.repeat(7)}";\n`,
    });
    const { status, out } = runGuard(dir);

    expect(status).toBe(1);
    expect(out).toContain("and 2 more (7 total in this file)");
  });

  it("does not flag genuinely binary files, matched by extension", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const dir = await repoWith({ "public/logo.png": png });
    const { status } = runGuard(dir);

    expect(status).toBe(0);
  });

  it("still scans an unfamiliar extension rather than skipping it", async () => {
    // The denylist is deliberate: an unknown type is scanned and fails loudly,
    // because an allowlist would skip it in silence — the very failure mode here.
    const dir = await repoWith({ "src/data.weirdext": `x${NUL}y` });
    const { status, out } = runGuard(dir);

    expect(status).toBe(1);
    expect(out).toContain("src/data.weirdext");
  });

  it("allows tab, newline and carriage return", async () => {
    const dir = await repoWith({ "src/ws.ts": "const a = 1;\r\n\tconst b = 2;\n" });
    const { status } = runGuard(dir);

    expect(status).toBe(0);
  });
});

describe("previously affected files stay plain text", () => {
  // Regression pins for the two live incidents. These read the real repo files,
  // so a reintroduced raw byte fails here as well as in CI.
  it.each([
    "src/lib/events/dedupe.ts",
    "src/lib/analytics-store.ts",
    "scripts/check-frozen.mjs",
  ])("%s contains no raw control bytes", (rel) => {
    const buf = readFileSync(path.resolve(__dirname, "../..", rel));
    const bad = [...buf].filter((b) => (b < 0x20 && ![9, 10, 13].includes(b)) || b === 0x7f);
    expect(bad).toEqual([]);
  });

  it("dedupe still separates composite keys with codepoint 0", () => {
    // The escape must survive as U+0000 — a stray edit to a space or a visible
    // character would silently change clustering, since titles contain spaces.
    const src = readFileSync(
      path.resolve(__dirname, "../../src/lib/events/dedupe.ts"),
      "utf8",
    );
    const separators = src.match(/\\u0000/g) ?? [];
    expect(separators.length).toBe(6);
  });
});
