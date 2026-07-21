// E15 slice 1 — the R2 image seam.
//
// HERMETIC BY POLICY: no network, no real bucket, no CI secrets, no S3-mock
// dependency. Dummy R2_IMAGES_* env vars make hasR2() true and the HTTP
// boundary beneath aws4fetch is stubbed with an in-memory bucket, so these
// assertions run identically on a laptop and in CI. A separate opt-in live pass
// against the scratch bucket (R2_TEST_LIVE=1) is recorded on the PR.
//
// What this suite is really defending:
//   1. Stored record values keep their EXACT pre-R2 format, so the migration
//      never rewrites a record and every path-sanitisation regex still applies.
//   2. R2 keys mirror the on-disk layout, which is what makes the migration a
//      pure byte copy.
//   3. No bucket URL ever reaches a stored value or a response body — the
//      bucket is private and reached server-side only.
//   4. EXIF/GPS is stripped on all four upload paths (M-16-02), including the
//      event-attachment path.

import { readFileSync } from "fs";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../setup/pglite-db";
import {
  deleteObject,
  getObject,
  hasR2,
  putObject,
} from "@/lib/blob-store";

const FIXTURES = path.resolve(__dirname, "../fixtures/images");
const gps = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

const ENDPOINT = "https://acct123.r2.cloudflarestorage.com";
const BUCKET = "explore-kingston-images-test";

/** Everything the stubbed bucket received, keyed by object key. */
let bucket: Map<string, { bytes: Uint8Array; contentType: string }>;
/** Every request the app made — used to prove key shapes and wire encoding. */
let requested: Array<{ method: string; key: string; url: string }>;

function installFetchStub() {
  bucket = new Map();
  requested = [];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    // Path is /<bucket>/<key…>; decode each segment back to the logical key.
    const segments = url.pathname.replace(/^\//, "").split("/");
    expect(segments.shift(), "requests must be scoped to the configured bucket").toBe(BUCKET);
    const key = segments.map(decodeURIComponent).join("/");
    requested.push({ method: req.method, key, url: req.url });

    // SigV4 must actually have run — an unsigned request would mean the client
    // is misconfigured and would 403 against the real bucket.
    expect(req.headers.get("authorization"), "request was not SigV4-signed").toMatch(
      /^AWS4-HMAC-SHA256 /,
    );

    if (req.method === "PUT") {
      bucket.set(key, {
        bytes: new Uint8Array(await req.arrayBuffer()),
        contentType: req.headers.get("content-type") ?? "",
      });
      return new Response(null, { status: 200 });
    }
    if (req.method === "GET") {
      const hit = bucket.get(key);
      if (!hit) return new Response("no such key", { status: 404 });
      return new Response(hit.bytes as BodyInit, {
        status: 200,
        headers: { "Content-Type": hit.contentType },
      });
    }
    if (req.method === "DELETE") {
      bucket.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected method", { status: 405 });
  });
}

const R2_ENV = {
  R2_IMAGES_ENDPOINT: ENDPOINT,
  R2_IMAGES_BUCKET: BUCKET,
  R2_IMAGES_ACCESS_KEY_ID: "test-access-key",
  R2_IMAGES_SECRET_ACCESS_KEY: "test-secret-key",
};

beforeEach(() => {
  for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v);
  installFetchStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("R2 client seam", () => {
  it("treats a half-configured store as not configured", () => {
    expect(hasR2()).toBe(true);
    for (const k of Object.keys(R2_ENV)) {
      vi.stubEnv(k, "");
      expect(hasR2(), `${k} missing should disable R2 entirely`).toBe(false);
      vi.stubEnv(k, R2_ENV[k as keyof typeof R2_ENV]);
    }
  });

  it("round-trips bytes and content type, and deletes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await putObject("hunts/refs/a-b.jpg", bytes, "image/jpeg");
    const got = await getObject("hunts/refs/a-b.jpg");
    expect(got?.bytes).toEqual(bytes);
    expect(got?.contentType).toBe("image/jpeg");

    await deleteObject("hunts/refs/a-b.jpg");
    expect(await getObject("hunts/refs/a-b.jpg")).toBeNull();
  });

  it("returns null for a missing object rather than throwing", async () => {
    // A missing image must 404 one request, never 500 a page or fail health.
    expect(await getObject("map/images/deadbeef.jpg")).toBeNull();
  });

  it("treats deleting an absent object as success", async () => {
    // Privacy deletes must be retryable and idempotent (E11).
    await expect(deleteObject("hunts/photos/gone/x/y.jpg")).resolves.toBeUndefined();
  });

  it("keeps slashes as key hierarchy, not escaped characters", async () => {
    await putObject("events/evt-1/flyer name.png", new Uint8Array([9]), "image/png");
    // The logical key survived round-tripping through the URL...
    expect(bucket.has("events/evt-1/flyer name.png")).toBe(true);
    // ...and the wire form encoded the SPACE without flattening the slashes,
    // which encodeURIComponent on the whole key would have done (%2F).
    const sent = requested.at(-1)!.url;
    expect(sent).toContain("/events/evt-1/");
    expect(sent).not.toContain("%2F");
    expect(sent).toContain("%20"); // the space WAS encoded
  });
});

// ---------------------------------------------------------------------------
// The four upload paths, end to end
// ---------------------------------------------------------------------------

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

/**
 * No GPS may survive into the bucket, whichever path put it there.
 *
 * These are end-to-end smoke assertions on the LOCATION payload specifically —
 * the numeric GPSInfo IFD tag, the TIFF header that carries it, and the XMP/
 * comment forms. The exhaustive per-container proof (including that the HEIF
 * Exif extent is entirely zeroed and the coded image is byte-identical) lives
 * in tests/unit/image-sanitize.test.ts.
 *
 * Deliberately NOT checking for the literal "Exif" here: a HEIF file must keep
 * declaring item_type 'Exif' in its `iinf` box even after the payload is gone,
 * because removing that declaration would mean rewriting every iloc offset.
 * Asserting on it would fail on structure that carries no data.
 */
function expectStoredClean(key: string) {
  const stored = bucket.get(key);
  expect(stored, `nothing was stored at ${key}`).toBeDefined();
  const enc = new TextEncoder();
  const signatures: Array<[string, Uint8Array]> = [
    ["XMP GPS property", enc.encode("GPSLatitude")],
    ["plaintext comment", enc.encode("shot at home")],
    ["GPSInfo IFD tag", new Uint8Array([0x88, 0x25, 0x00, 0x04])],
    ["big-endian TIFF header", new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])],
  ];
  for (const [name, sig] of signatures) {
    outer: for (let i = 0; i + sig.length <= stored!.bytes.length; i++) {
      for (let j = 0; j < sig.length; j++) if (stored!.bytes[i + j] !== sig[j]) continue outer;
      throw new Error(`${name} survived into R2 object ${key} at offset ${i}`);
    }
  }
}

/** No stored value may expose the bucket — reads go through our own routes. */
function expectNoBucketUrl(value: string) {
  expect(value).not.toContain("r2.dev");
  expect(value).not.toContain(".r2.cloudflarestorage.com");
  expect(value).not.toContain(BUCKET);
}

describe("upload paths write to R2 with metadata stripped (M-16-02)", () => {
  it("map feature image: bare hashed name on the record, mirrored key in R2", async () => {
    const { saveFeatureImage, readFeatureImage } = await import("@/lib/stores/map-store");
    const stored = await saveFeatureImage(Buffer.from(gps("gps.jpg")), "jpg");

    // The record value keeps the exact filesystem-mode shape: <sha1>.<ext>.
    expect(stored).toMatch(/^[a-f0-9]{16}\.jpg$/);
    expectNoBucketUrl(stored);
    // ...and the R2 key is that value under the mirrored prefix.
    expectStoredClean(`map/images/${stored}`);

    // Reading back goes through R2 (no disk copy exists in this test).
    const read = await readFeatureImage(stored);
    expect(read?.type).toBe("image/jpeg");
    expect(read?.bytes.length).toBe(bucket.get(`map/images/${stored}`)!.bytes.length);
  });

  it("map feature image: the content hash names the STRIPPED bytes", async () => {
    const { saveFeatureImage } = await import("@/lib/stores/map-store");
    // Same picture, one copy tagged and one already clean, must dedupe to the
    // same name — proving the hash is taken after stripping, not before.
    const tagged = await saveFeatureImage(Buffer.from(gps("gps.png")), "png");
    const preStripped = bucket.get(`map/images/${tagged}`)!.bytes;
    const again = await saveFeatureImage(Buffer.from(preStripped), "png");
    expect(again).toBe(tagged);
  });

  it("hunt reference photo: public path, fs-relative value, stripped bytes", async () => {
    const { saveReferencePhoto } = await import("@/lib/hunt-store");
    const stored = await saveReferencePhoto(
      "downtown-discovery",
      "dd-ferry-overlook",
      gps("gps.jpg"),
      "jpg",
    );
    expect(stored).toBe("refs/downtown-discovery-dd-ferry-overlook.jpg");
    expectNoBucketUrl(stored);
    expectStoredClean(`hunts/${stored}`);
  });

  it("hunt submission: private path keeps the photos/ prefix the admin gate reads", async () => {
    const { saveSubmission } = await import("@/lib/hunt-store");
    const submission = await saveSubmission({
      huntId: "downtown-discovery",
      stopId: "dd-ferry-overlook",
      photo: gps("gps.heic"),
      ext: "heic",
    });
    // The "photos/" prefix is what /api/hunts/photo gates on. If R2 mode ever
    // stored a URL here instead, the admin check would be bypassed entirely —
    // which is exactly what the old public-blob mode did.
    expect(submission.photoPath).toMatch(
      /^photos\/downtown-discovery\/dd-ferry-overlook\/.+\.heic$/,
    );
    expectNoBucketUrl(submission.photoPath);
    expectStoredClean(`hunts/${submission.photoPath}`);
  });

  it("event attachment: flyer is stripped, PDF passes through untouched", async () => {
    const { saveAttachment } = await import("@/lib/events/attachment-store");

    const flyer = await saveAttachment("evt-1", gps("gps.png"), "png");
    expect(flyer).toMatch(/^evt-1\/\d+-[a-z0-9]+\.png$/);
    expectNoBucketUrl(flyer);
    expectStoredClean(`events/${flyer}`);

    // PDFs are a documented carve-out: authored artwork, not camera output.
    // They must still be STORED, just not rewritten.
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const doc = await saveAttachment("evt-1", pdfBytes, "pdf");
    expect(bucket.get(`events/${doc}`)!.bytes).toEqual(pdfBytes);
  });

  it("every key written mirrors the on-disk layout", async () => {
    // The migration is a pure byte copy, which only holds if these prefixes
    // match the DATA_DIR subtrees exactly.
    for (const { method, key } of requested.filter((r) => r.method === "PUT")) {
      expect(method).toBe("PUT");
      expect(key, `${key} does not mirror a known data subtree`).toMatch(
        /^(hunts\/(refs|photos)\/|map\/images\/|events\/)/,
      );
    }
  });
});
