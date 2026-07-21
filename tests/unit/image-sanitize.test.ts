// M-16-02 — EXIF/GPS stripping. This suite is the launch gate: it is CI-blocking
// and never waivable (v2 decisions doc §6b).
//
// The fixtures in tests/fixtures/images/ each carry 47°48'0"N 122°30'0"W in
// every metadata channel their container supports, written byte-by-byte by
// scripts/make-image-fixtures.mjs. We parse the STRIPPED buffer here rather
// than shelling out to exiftool, so the assertions hold in CI with no image
// tooling installed.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { canStrip, stripImageMetadata, UnstrippableImageError } from "@/lib/image-sanitize";

const FIXTURES = path.resolve(__dirname, "../fixtures/images");
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

/** Byte signatures that must not survive stripping, whatever the container. */
const LEAK_SIGNATURES: Array<[string, Uint8Array]> = [
  ["Exif header", new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])], // "Exif\0\0"
  ["XMP namespace", new TextEncoder().encode("adobe:ns:meta")],
  ["XMP GPS property", new TextEncoder().encode("GPSLatitude")],
  ["plaintext comment", new TextEncoder().encode("shot at home")],
];

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function allIndexesOf(haystack: Uint8Array, needle: Uint8Array): number[] {
  const hits: number[] = [];
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    hits.push(i);
  }
  return hits;
}

/**
 * `allowed` marks byte ranges where a signature may legitimately appear as
 * CONTAINER STRUCTURE rather than as data. HEIF declares its metadata item in
 * `iinf` as item_type 'Exif' followed by an empty null-terminated item_name —
 * which reads as the six bytes "Exif\0\0" even after the payload is gone.
 * Blanking that declaration would mean rewriting the box tree, which is exactly
 * the offset-recomputation this strategy avoids. So we assert precisely: every
 * occurrence must START inside the declaration, and none may be payload.
 *
 * Match on the START offset, not full containment: in a real ImageIO file the
 * declaration ends "...Exif\0" as the last bytes of `iinf`, so the six-byte
 * "Exif\0\0" signature picks up its final zero from the length prefix of the
 * NEXT box and straddles the boundary. That straddle is still structure.
 */
function expectNoMetadata(out: Uint8Array, label: string, allowed: Array<[number, number]> = []) {
  for (const [name, sig] of LEAK_SIGNATURES) {
    const hits = allIndexesOf(out, sig).filter(
      (at) => !allowed.some(([s, e]) => at >= s && at < e),
    );
    expect(hits, `${label}: ${name} survived stripping at ${hits.join(",")}`).toEqual([]);
  }
  // The GPS IFD tag (0x8825) followed by its LONG type — the numeric form the
  // string checks above would miss.
  expect(
    indexOfBytes(out, new Uint8Array([0x88, 0x25, 0x00, 0x04])),
    `${label}: GPSInfoIFD tag survived stripping`,
  ).toBe(-1);
}

describe("stripImageMetadata — the GPS never survives (M-16-02)", () => {
  it("JPEG: drops APP1(Exif), APP1(XMP) and COM, keeps the image", () => {
    const src = fixture("gps.jpg");
    // Sanity: the fixture really is tagged, or this test proves nothing.
    expect(indexOfBytes(src, LEAK_SIGNATURES[0][1])).toBeGreaterThan(-1);

    const out = stripImageMetadata(src, "image/jpeg");
    expectNoMetadata(out, "jpeg");
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8); // SOI
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9); // EOI
    // A baseline frame header must survive, or we ate image structure.
    expect(indexOfBytes(out, new Uint8Array([0xff, 0xc0]))).toBeGreaterThan(-1);
    expect(out.length).toBeLessThan(src.length);
  });

  it("PNG: drops eXIf/tEXt/iTXt, keeps IHDR+IDAT+IEND and the dimensions", () => {
    const src = fixture("gps.png");
    const out = stripImageMetadata(src, "image/png");
    expectNoMetadata(out, "png");

    const enc = new TextEncoder();
    expect(indexOfBytes(out, enc.encode("IHDR"))).toBeGreaterThan(-1);
    expect(indexOfBytes(out, enc.encode("IDAT"))).toBeGreaterThan(-1);
    expect(indexOfBytes(out, enc.encode("IEND"))).toBeGreaterThan(-1);
    expect(indexOfBytes(out, enc.encode("eXIf"))).toBe(-1);
    expect(indexOfBytes(out, enc.encode("tEXt"))).toBe(-1);

    // IHDR payload starts 16 bytes in: width/height as big-endian uint32.
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(16)).toBe(64);
    expect(view.getUint32(20)).toBe(48);
  });

  it("WebP: drops EXIF/XMP chunks, clears the VP8X flags and fixes RIFF size", () => {
    const src = fixture("gps.webp");
    const out = stripImageMetadata(src, "image/webp");
    expectNoMetadata(out, "webp");

    const enc = new TextEncoder();
    expect(indexOfBytes(out, enc.encode("EXIF"))).toBe(-1);
    expect(indexOfBytes(out, enc.encode("XMP "))).toBe(-1);

    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    // RIFF payload size must describe the rebuilt file, or decoders reject it.
    expect(view.getUint32(4, true)).toBe(out.length - 8);

    // VP8X survives, but its EXIF(bit3)/XMP(bit2) flags must be cleared —
    // advertising chunks that are no longer present is a corrupt file.
    const vp8x = indexOfBytes(out, enc.encode("VP8X"));
    expect(vp8x).toBeGreaterThan(-1);
    expect(out[vp8x + 8] & 0b0000_1100).toBe(0);
  });

  it("GIF: drops the comment and XMP extensions, keeps looping and the frame", () => {
    const src = fixture("gps.gif");
    const out = stripImageMetadata(src, "image/gif");
    expectNoMetadata(out, "gif");

    expect(String.fromCharCode(...out.subarray(0, 3))).toBe("GIF");
    expect(out[out.length - 1]).toBe(0x3b); // trailer
    expect(indexOfBytes(out, new TextEncoder().encode("XMP Data"))).toBe(-1);
    // The image descriptor (0x2C) must still be there.
    expect(indexOfBytes(out, new Uint8Array([0x2c]))).toBeGreaterThan(-1);
  });

  it("HEIC: zeroes the Exif item in place, byte-for-byte preserving the image", () => {
    const src = fixture("gps.heic");
    expect(indexOfBytes(src, LEAK_SIGNATURES[0][1])).toBeGreaterThan(-1);

    const out = stripImageMetadata(src, "image/heic");

    // The `iinf` box legitimately still names the item type — see the note on
    // expectNoMetadata. Everything outside it must be clean.
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const iinfAt = indexOfBytes(out, new TextEncoder().encode("iinf")) - 4;
    expect(iinfAt).toBeGreaterThan(0);
    const iinfEnd = iinfAt + view.getUint32(iinfAt);
    expectNoMetadata(out, "heic", [[iinfAt, iinfEnd]]);

    // In-place zeroing: the container must be the exact same size, so every
    // iloc offset in the file stays valid.
    expect(out.length).toBe(src.length);

    // ftyp/meta must be untouched — only the Exif payload changed.
    expect(String.fromCharCode(...out.subarray(4, 8))).toBe("ftyp");
    const metaAt = indexOfBytes(out, new TextEncoder().encode("meta"));
    expect(metaAt).toBeGreaterThan(-1);
    expect(out.subarray(0, metaAt)).toEqual(src.subarray(0, metaAt));

    // The strongest assertion available: the Exif item's own extent, read from
    // iloc exactly as a decoder would, must be entirely zero bytes.
    const exifExtent = out.subarray(503, 641);
    expect(exifExtent.length).toBe(138);
    expect(exifExtent.every((b) => b === 0), "the Exif extent is not fully zeroed").toBe(true);
    // ...and the coded image item next to it must be untouched.
    expect(out.subarray(641, 688)).toEqual(src.subarray(641, 688));

    // Everything that changed must have become a zero. Any non-zero difference
    // means we rewrote image data rather than blanking metadata.
    let changed = 0;
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== out[i]) {
        changed++;
        expect(out[i], `byte ${i} changed to something other than 0`).toBe(0);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("is idempotent — stripping already-clean bytes is a no-op", () => {
    for (const [name, type] of [
      ["gps.jpg", "image/jpeg"],
      ["gps.png", "image/png"],
      ["gps.webp", "image/webp"],
      ["gps.gif", "image/gif"],
      ["gps.heic", "image/heic"],
    ] as const) {
      const once = stripImageMetadata(fixture(name), type);
      const twice = stripImageMetadata(once, type);
      expect(twice, `${name} is not idempotent`).toEqual(once);
    }
  });

  it("never mutates the caller's buffer", () => {
    const src = fixture("gps.heic");
    const before = new Uint8Array(src);
    stripImageMetadata(src, "image/heic");
    expect(src).toEqual(before);
  });
});

describe("stripImageMetadata — fails closed", () => {
  it("rejects a content type it cannot prove clean", () => {
    expect(canStrip("application/pdf")).toBe(false);
    expect(() => stripImageMetadata(fixture("gps.jpg"), "application/pdf")).toThrow(
      UnstrippableImageError,
    );
  });

  it("throws rather than passing through unparseable bytes", () => {
    const junk = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]);
    expect(() => stripImageMetadata(junk, "image/jpeg")).toThrow(UnstrippableImageError);
    expect(() => stripImageMetadata(new Uint8Array([1, 2, 3]), "image/png")).toThrow(
      UnstrippableImageError,
    );
    expect(() => stripImageMetadata(new Uint8Array([1, 2, 3]), "image/heic")).toThrow(
      UnstrippableImageError,
    );
  });

  it("declares exactly the containers it can handle", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]) {
      expect(canStrip(t), `${t} should be strippable`).toBe(true);
    }
    for (const t of ["application/pdf", "image/svg+xml", "text/html"]) {
      expect(canStrip(t), `${t} must not be treated as strippable`).toBe(false);
    }
  });
});
