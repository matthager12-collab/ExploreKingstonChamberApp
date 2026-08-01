// E17 CI grep gates — the "Never" tier, made mechanical:
//  (1) read-only vendor contract: the single exported GraphQL document is a
//      `query`; no mutation document, no vendor write name, and no
//      cookie/session code exists under src/lib/import;
//  (2) `cloudinary` renders nowhere: zero hits under src/app and
//      src/components (vendor image URLs are stored provenance only);
//  (3) `isPromoted` influences nothing outside the import layer (featured
//      placement is Chamber-curated fair rotation, never pay-to-play).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { IMPORT_QUERY_DOCUMENT } from "@/lib/import/qwick";

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const SRC_EXTS = [".ts", ".tsx"];

describe("read-only vendor contract", () => {
  it("the exported GraphQL document is a query and contains no mutation token", () => {
    expect(IMPORT_QUERY_DOCUMENT.trimStart().startsWith("query")).toBe(true);
    expect(IMPORT_QUERY_DOCUMENT).not.toMatch(/\bmutation\b/i);
  });

  it("src/lib/import holds no mutation document, vendor write name, or cookie code", () => {
    for (const file of walk("src/lib/import", SRC_EXTS)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bmutation\s*[{(]/i);
      expect(text, file).not.toMatch(/\b(addData|updateData|deleteData)\b/);
      expect(text, file).not.toMatch(/cookie/i);
    }
  });

  it("exactly one file under src/lib/import declares the GraphQL document", () => {
    const declaring = walk("src/lib/import", SRC_EXTS).filter((f) =>
      readFileSync(f, "utf8").includes("signByLicense("),
    );
    expect(declaring).toEqual(["src/lib/import/qwick.ts"]);
  });
});

describe("cloudinary / isPromoted containment", () => {
  it("`cloudinary` appears nowhere under src/app or src/components", () => {
    for (const dir of ["src/app", "src/components"]) {
      const offenders = walk(dir, SRC_EXTS).filter((f) =>
        /cloudinary/i.test(readFileSync(f, "utf8")),
      );
      expect(offenders).toEqual([]);
    }
  });

  it("`isPromoted` is consumed nowhere outside src/lib/import (tests exempt per charter)", () => {
    const offenders = walk("src", SRC_EXTS).filter(
      (f) =>
        !f.startsWith(join("src", "lib", "import")) &&
        !/\.test\.tsx?$/.test(f) &&
        /\bisPromoted\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
