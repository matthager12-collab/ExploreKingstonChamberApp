// E09 immutability guard (M-15-08): no code path may UPDATE or DELETE audit
// rows — the DB trigger (migration 0001) enforces it at runtime and
// tests/unit/audit-immutable.test.ts proves the trigger fires; THIS suite
// keeps the code clean of any such statement in the first place, so the
// mistake is caught in CI before it ever meets the trigger. Scans the same
// patterns the epic's acceptance grep uses, over src/, scripts/ and the
// migrations dir (where only 0001's trigger DDL mentions audit UPDATE/DELETE
// — and in a form none of these patterns match).

import { readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

// Mirrors AC 7: SQL-string forms and Drizzle-builder forms. The \b after
// "audit" keeps identifiers like auditRows out of scope.
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "SQL DELETE FROM audit", re: /delete\s+from\s+audit\b/i },
  { name: "SQL UPDATE audit SET", re: /update\s+audit\s+set\b/i },
  { name: "Drizzle .delete(audit)", re: /\.delete\(\s*audit\b/ },
  { name: "Drizzle .update(audit)", re: /\.update\(\s*audit\b/ },
];

describe("audit append-only guard (code scan)", () => {
  it("no UPDATE/DELETE against the audit table anywhere in src/, scripts/, or migrations", async () => {
    const files = await fg(
      ["src/**/*.{ts,tsx,mjs,js}", "scripts/**/*.{ts,tsx,mjs,js}", "db/migrations/**/*.sql"],
      { cwd: ROOT, absolute: true },
    );
    expect(files.length).toBeGreaterThan(50); // glob tripwire

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const { name, re } of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${path.relative(ROOT, file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
