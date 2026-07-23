import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the R2 client so these run with no network/creds (CI-safe).
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("aws4fetch", () => ({
  AwsClient: vi.fn(() => ({ fetch: fetchMock })),
}));

import { getTileObject, hasTilesR2, isValidTileKey } from "@/lib/map/tiles-store";

const ENV = {
  R2_TILES_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_TILES_BUCKET: "visit-kingston-tiles",
  R2_TILES_ACCESS_KEY_ID: "a".repeat(32),
  R2_TILES_SECRET_ACCESS_KEY: "b".repeat(64),
} as const;
const KEYS = Object.keys(ENV);
const setEnv = () => Object.assign(process.env, ENV);
const clearEnv = () => KEYS.forEach((k) => delete process.env[k]);

describe("isValidTileKey", () => {
  it.each(["kingston.pmtiles", "kingston-20260722.pmtiles", "a.pmtiles"])(
    "accepts %s",
    (k) => expect(isValidTileKey(k)).toBe(true),
  );
  it.each(["../secret.pmtiles", "kingston.txt", "a/b.pmtiles", "", "Kingston.PMTILES", ".pmtiles", "kingston.pmtiles/x"])(
    "rejects %s",
    (k) => expect(isValidTileKey(k)).toBe(false),
  );
});

describe("hasTilesR2", () => {
  afterEach(clearEnv);
  it("false when unset", () => { clearEnv(); expect(hasTilesR2()).toBe(false); });
  it("false when partial", () => { setEnv(); delete process.env.R2_TILES_SECRET_ACCESS_KEY; expect(hasTilesR2()).toBe(false); });
  it("true when complete", () => { setEnv(); expect(hasTilesR2()).toBe(true); });
});

describe("getTileObject", () => {
  beforeEach(() => { setEnv(); fetchMock.mockReset(); });
  afterEach(clearEnv);

  const r2 = (status: number, headers: Record<string, string> = {}) =>
    new Response(status === 404 ? "no" : "bytes", { status, headers });

  it("forwards Range verbatim and maps R2's 206 through", async () => {
    fetchMock.mockResolvedValue(r2(206, { "content-range": "bytes 0-99/1077980", "content-length": "100", etag: '"abc"' }));
    const out = await getTileObject("kingston.pmtiles", "bytes=0-99");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/visit-kingston-tiles/kingston.pmtiles");
    expect(opts.headers).toEqual({ Range: "bytes=0-99" });

    expect(out?.status).toBe(206);
    expect(out?.headers.get("Content-Range")).toBe("bytes 0-99/1077980");
    expect(out?.headers.get("Accept-Ranges")).toBe("bytes");
    expect(out?.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(out?.headers.get("ETag")).toBe('"abc"');
    expect(out?.headers.get("Cache-Control")).toContain("max-age");
    expect(out?.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("sends no Range header on a full read (200)", async () => {
    fetchMock.mockResolvedValue(r2(200, { "content-length": "1077980" }));
    const out = await getTileObject("kingston.pmtiles");
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(out?.status).toBe(200);
  });

  it("returns null on 404", async () => {
    fetchMock.mockResolvedValue(r2(404));
    expect(await getTileObject("missing.pmtiles")).toBeNull();
  });

  it("throws on an unexpected upstream status", async () => {
    fetchMock.mockResolvedValue(r2(500));
    await expect(getTileObject("kingston.pmtiles")).rejects.toThrow(/500/);
  });

  it("throws when R2_TILES_* is not configured", async () => {
    delete process.env.R2_TILES_ENDPOINT;
    await expect(getTileObject("kingston.pmtiles")).rejects.toThrow(/not configured/);
  });
});
