// Offline policy for the one advisory approved for this bounded fix.
// Does not send the dependency inventory to any external service.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/dist/server/image-optimizer"));
const decoder = nextRequire("sharp");
const atLeast = (actual: string, minimum: string) => {
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isInteger(a[i])) return false;
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
};

function allowed(versions: { sharp: string; vips: string }) {
  return atLeast(versions.sharp, "0.35.3") && atLeast(versions.vips, "8.18.3");
}

describe("patched native decoder used by Next image optimizer", () => {
  it("rejects the known vulnerable dependency fixture offline", () => {
    expect(allowed({ sharp: "0.34.5", vips: "8.17.3" })).toBe(false);
    expect(allowed({ sharp: "0.35.3", vips: "8.17.3" })).toBe(false);
  });
  it("loads patched sharp/libvips through Next's own resolution path", () => {
    expect(allowed(decoder.versions), JSON.stringify(decoder.versions)).toBe(true);
  });
  it("has no vulnerable sharp copy in the production lockfile", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const entries = Object.entries(lock.packages).filter(([key]) => key.endsWith("node_modules/sharp"));
    expect(entries.length).toBeGreaterThan(0);
    for (const [, value] of entries) expect(atLeast((value as {version:string}).version, "0.35.3")).toBe(true);
  });
  it("decodes GIF through Next's optimizer with the patched native library", async () => {
    const { optimizeImage } = nextRequire("./image-optimizer");
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const result = await optimizeImage({ buffer: gif, contentType: "image/webp", quality: 75, width: 64 });
    expect(result.subarray(8, 12).toString()).toBe("WEBP");
  });
  it("rejects disguised corrupt input before successful conversion", async () => {
    const { optimizeImage } = nextRequire("./image-optimizer");
    await expect(optimizeImage({ buffer: Buffer.from("not a png"), contentType: "image/png", quality: 75, width: 64 })).rejects.toThrow();
  });
});
