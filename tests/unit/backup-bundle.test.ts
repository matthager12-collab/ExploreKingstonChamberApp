import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  streamBundleDocument,
  collectBundleFiles,
} from "@/lib/backup-bundle";

// Real filesystem, no DB: streamBundleDocument takes the db section as a plain
// argument, so we pass a stub and never need Postgres here. (The full curl +
// memory-capped streaming run is the step-8 runtime verification.)

let root: string;
const binBytes = crypto.randomBytes(4096);

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "e10-bundle-"));
  // A nested text file (inlined utf8) and a nested binary file (base64).
  await mkdir(path.join(root, "stores"), { recursive: true });
  await writeFile(path.join(root, "stores", "foo.json"), '{"hi":"there"}');
  await mkdir(path.join(root, "hunts", "photos"), { recursive: true });
  await writeFile(path.join(root, "hunts", "photos", "pic.bin"), binBytes);
  // Things that MUST be excluded from the bundle.
  await mkdir(path.join(root, "backups"), { recursive: true });
  await writeFile(path.join(root, "backups", "old.tar"), "prior tarball");
  await mkdir(path.join(root, "geoip"), { recursive: true });
  await writeFile(path.join(root, "geoip", "dbip-city-lite.mmdb"), "geo blob");
  await writeFile(path.join(root, ".health-probe"), "123");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function streamToString(dbSection: unknown): Promise<string> {
  let out = "";
  for await (const chunk of streamBundleDocument(root, {
    createdAt: "2026-07-20T00:00:00.000Z",
    dbSection,
  })) {
    out += chunk;
  }
  return out;
}

describe("backup bundle streaming", () => {
  it("concatenated chunks parse into a valid bundle with matching fileCount", async () => {
    const json = await streamToString({ note: "stub-db" });
    const bundle = JSON.parse(json); // throws if the stream is not valid JSON
    expect(bundle.app).toBe("explore-kingston");
    expect(bundle.version).toBe(2);
    expect(bundle.createdAt).toBe("2026-07-20T00:00:00.000Z");
    expect(Array.isArray(bundle.files)).toBe(true);
    expect(bundle.fileCount).toBe(bundle.files.length); // trailing count is honest
    expect(bundle.db).toEqual({ note: "stub-db" });
  });

  it("excludes backups/, geoip/, and .health-probe", async () => {
    const bundle = JSON.parse(await streamToString({}));
    const paths: string[] = bundle.files.map((f: { path: string }) => f.path);
    expect(paths).toContain(path.join("stores", "foo.json"));
    expect(paths).toContain(path.join("hunts", "photos", "pic.bin"));
    expect(paths.some((p) => p.startsWith("backups"))).toBe(false);
    expect(paths.some((p) => p.startsWith("geoip"))).toBe(false);
    expect(paths.some((p) => p.includes(".health-probe"))).toBe(false);
  });

  it("collectBundleFiles applies the same exclusions", async () => {
    const files = await collectBundleFiles(root);
    const paths = files.map((f) => f.path);
    expect(paths.sort()).toEqual(
      [path.join("hunts", "photos", "pic.bin"), path.join("stores", "foo.json")].sort(),
    );
    const pic = files.find((f) => f.path.endsWith("pic.bin"))!;
    expect(pic.encoding).toBe("base64");
    const foo = files.find((f) => f.path.endsWith("foo.json"))!;
    expect(foo.encoding).toBe("utf8");
  });

  it("round-trips through scripts/restore-backup.mjs byte-for-byte", async () => {
    const json = await streamToString({ note: "stub" });
    const bundlePath = path.join(root, "bundle.json");
    await writeFile(bundlePath, json);
    const target = await mkdtemp(path.join(os.tmpdir(), "e10-restore-"));
    try {
      execFileSync("node", ["scripts/restore-backup.mjs", bundlePath, target], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
      const restored = await readFile(path.join(target, "hunts", "photos", "pic.bin"));
      expect(restored.equals(binBytes)).toBe(true);
      const restoredText = await readFile(path.join(target, "stores", "foo.json"), "utf8");
      expect(restoredText).toBe('{"hi":"there"}');
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});
