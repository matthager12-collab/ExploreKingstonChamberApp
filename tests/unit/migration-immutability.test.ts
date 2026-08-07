// A migration that has shipped is FROZEN. This test is why.
//
// WHAT WENT WRONG (2026-08-07, production deploy failure). The feedback table
// shipped as 0010_kind_morph and was applied to the production database. A
// follow-up PR wanted a primary key on that table, and — reasoning that the
// table was "new in this branch anyway" — REGENERATED 0010 instead of adding an
// ALTER. The branch had in fact already merged and deployed.
//
// drizzle's migrator identifies applied migrations by the SHA-256 of the .sql
// FILE CONTENT, not by its index or name. Rewriting 0010 changed its hash, so
// the migrator considered it unapplied and re-ran `CREATE TABLE
// "feedback_response"` against a table that already existed. runMigrations()
// rejects on failure (deliberately — see src/lib/db/migrate.ts), so the boot
// failed and Render refused to cut over. No outage, because that design fails
// closed; but main was undeployable until 0010 was restored byte-for-byte and
// the primary key re-issued as 0011.
//
// The guard: every migration's hash is pinned in tests/fixtures/. Editing a
// shipped migration fails here instead of in a production boot log. ADDING one
// is expected — regenerate the fixture and commit it as a visible, reviewable
// line of the diff:
//
//   node -e 'const fs=require("fs"),c=require("crypto"),p=require("path");const d="db/migrations";const j=JSON.parse(fs.readFileSync(p.join(d,"meta/_journal.json"),"utf8"));const o={};for(const e of j.entries)o[e.tag]=c.createHash("sha256").update(fs.readFileSync(p.join(d,e.tag+".sql"),"utf8")).digest("hex");fs.writeFileSync("tests/fixtures/migration-hashes.json",JSON.stringify(o,null,2)+"\n")'

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import pinned from "../fixtures/migration-hashes.json";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

interface JournalEntry {
  idx: number;
  tag: string;
}

function journal(): JournalEntry[] {
  const raw = readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function hashOf(tag: string): string {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  return createHash("sha256").update(sql).digest("hex");
}

describe("checked-in migrations are immutable once shipped", () => {
  const entries = journal();
  const pins = pinned as Record<string, string>;

  it("has a journal with entries", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries.map((e) => [e.tag] as const))(
    "%s is byte-identical to the pinned hash",
    (tag) => {
      // A miss here means either (a) you edited a migration that may already be
      // applied to a real database — restore it and put your change in a NEW
      // migration, or (b) you added one and have not refreshed the fixture.
      expect(pins[tag], `${tag} is not pinned — refresh tests/fixtures/migration-hashes.json`).toBeDefined();
      expect(hashOf(tag)).toBe(pins[tag]);
    },
  );

  it("pins nothing that the journal no longer lists", () => {
    // Catches the other half of the mistake: DELETING a shipped migration.
    // Production still has its hash recorded, so a rename or removal desyncs
    // the two forever.
    const tags = new Set(entries.map((e) => e.tag));
    expect(Object.keys(pins).filter((t) => !tags.has(t))).toEqual([]);
  });

  it("numbers migrations contiguously from 0, so none was dropped", () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });
});
