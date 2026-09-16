// The image routes redirect ONLY to URLs this deployment's own blob store
// produced. isTrustedBlobUrl derives the one allowed hostname from
// BLOB_READ_WRITE_TOKEN (`vercel_blob_rw_<storeId>_<secret>` →
// `<storeId>.public.blob.vercel-storage.com`), and with no token configured
// nothing is trusted at all — putImage() cannot run without the token, so no
// stored value this deployment produced can be a vercel-storage URL.

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedBlobUrl } from "@/lib/blob-store";
import { GET as mapImageGet } from "@/app/api/map/image/route";
import { GET as huntsPhotoGet } from "@/app/api/hunts/photo/route";

// Matches the abc123 store id in RW_TOKEN below.
const TRUSTED = "https://abc123.public.blob.vercel-storage.com/map/images/x.jpg";
const RW_TOKEN = "vercel_blob_rw_abc123_notarealsecret";
const OTHER_STORE = "https://zzz999.public.blob.vercel-storage.com/map/images/x.jpg";
const EVIL = "https://evil.example/phish";
const SUBSTRING_TRICK = "https://evil.example/.public.blob.vercel-storage.com";

function get(path: string, p: string) {
  return new NextRequest(`http://localhost${path}?p=${encodeURIComponent(p)}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redirect scoping on image routes", () => {
  it("map/image redirects only our own blob host", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", RW_TOKEN);
    expect((await mapImageGet(get("/api/map/image", EVIL))).status).toBe(404);
    const trusted = await mapImageGet(get("/api/map/image", TRUSTED));
    expect(trusted.status).toBe(302);
    expect(trusted.headers.get("location")).toBe(TRUSTED);
    expect((await mapImageGet(get("/api/map/image", SUBSTRING_TRICK))).status).toBe(404);
    expect((await mapImageGet(get("/api/map/image", OTHER_STORE))).status).toBe(404);
  });

  it("hunts/photo redirects only our own blob host", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", RW_TOKEN);
    expect((await huntsPhotoGet(get("/api/hunts/photo", EVIL))).status).toBe(404);
    const trusted = await huntsPhotoGet(get("/api/hunts/photo", TRUSTED));
    expect(trusted.status).toBe(302);
    expect(trusted.headers.get("location")).toBe(TRUSTED);
    expect((await huntsPhotoGet(get("/api/hunts/photo", SUBSTRING_TRICK))).status).toBe(404);
  });

  it("isTrustedBlobUrl accepts exactly the configured store's hostname", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", RW_TOKEN);
    expect(isTrustedBlobUrl(TRUSTED)).toBe(true);
    // A different store id is a well-formed vercel-storage URL — but not OURS.
    expect(isTrustedBlobUrl(OTHER_STORE)).toBe(false);
    // Dot-boundary / substring tricks.
    expect(isTrustedBlobUrl("https://xpublic.blob.vercel-storage.com")).toBe(false);
    expect(isTrustedBlobUrl("https://abc123.public.blob.vercel-storage.com.evil.example/x")).toBe(
      false,
    );
    // https only, URLs only, strings only.
    expect(isTrustedBlobUrl("http://abc123.public.blob.vercel-storage.com/x.jpg")).toBe(false);
    expect(isTrustedBlobUrl("map/images/x.jpg")).toBe(false);
    expect(isTrustedBlobUrl(42)).toBe(false);
  });

  it("isTrustedBlobUrl trusts NOTHING when the blob store is not configured", () => {
    // R2/filesystem deployments store fs-relative paths; putImage() cannot run
    // without the token, so no stored value can be a vercel-storage URL here.
    expect(isTrustedBlobUrl(TRUSTED)).toBe(false);
    expect(isTrustedBlobUrl(OTHER_STORE)).toBe(false);
  });
});
