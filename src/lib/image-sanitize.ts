// EXIF/XMP/IPTC metadata stripping for every uploaded image (M-16-02).
//
// WHY THIS EXISTS: a photo taken on a phone carries the GPS coordinates of the
// place it was taken. Hunt players are often kids photographing a stop; event
// flyers are member-submitted and become PUBLIC once approved. Serving those
// bytes unmodified publishes a precise location trail. This is the child-safety
// launch floor in the v2 decisions doc §6b — it is never waivable.
//
// SCOPE: this module removes METADATA ONLY. It never re-encodes pixels, never
// resizes, never changes the visual result. An image-variant pipeline is a
// separate backlog item (Content v2); conflating the two is how metadata
// stripping ends up gated behind a heavy native dependency.
//
// FAIL-CLOSED BY DESIGN: every function here THROWS on input it cannot fully
// parse. A caller that cannot strip must reject the upload, because the
// alternative — storing bytes we could not verify — is exactly the outcome the
// requirement forbids. This mirrors the repo's existing posture for /es safety
// copy (src/lib/page-visibility.tsx): when in doubt, stay dark.
//
// NOT COVERED (documented in docs/LAUNCH.md, deliberately):
//   - PDF event attachments. PDFs carry XMP/DocInfo (author, producer), but
//     they are authored artwork rather than camera output, so they are not a
//     GPS vector. Passed through untouched; noted as a backlog item.
//   - Images already stored before launch. The R2 migration copies bytes
//     VERBATIM so the parity check can compare by byte equality; a one-off
//     sweep of pre-existing images is backlogged.

/** Containers we can prove clean. Anything else must be rejected by the caller. */
const STRIPPABLE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export function canStrip(contentType: string): boolean {
  return STRIPPABLE.has(contentType.toLowerCase());
}

export class UnstrippableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnstrippableImageError";
  }
}

function fail(why: string): never {
  throw new UnstrippableImageError(`image-sanitize: ${why}`);
}

/**
 * Remove all metadata that can carry location from an uploaded image.
 *
 * Returns NEW bytes; never mutates the input. Throws UnstrippableImageError
 * when the container cannot be parsed or the content type is unsupported —
 * callers must let that reject the upload rather than storing the original.
 */
export function stripImageMetadata(bytes: Uint8Array, contentType: string): Uint8Array {
  const type = contentType.toLowerCase();
  if (!canStrip(type)) fail(`unsupported content type ${contentType}`);
  switch (type) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    case "image/gif":
      return stripGif(bytes);
    default:
      return stripHeif(bytes);
  }
}

// ---------------------------------------------------------------------------
// JPEG — rebuild the marker stream, dropping metadata segments.
// ---------------------------------------------------------------------------

// APP1 = Exif and XMP. APP13 = Photoshop/IPTC (which has its own GPS fields).
// APP0 (JFIF) and APP2 (ICC colour profile) are KEPT: dropping ICC visibly
// shifts colour, and neither carries location.
const JPEG_DROP_MARKERS = new Set([0xe1, 0xed, 0xfe]); // APP1, APP13, COM

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("not a JPEG (no SOI)");
  const keep: Array<[number, number]> = [[0, 2]]; // SOI
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) fail(`expected a marker at offset ${i}`);
    // Skip fill bytes: a marker may be padded with any number of 0xFF.
    let m = i + 1;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    if (m >= bytes.length) fail("truncated marker");
    const marker = bytes[m];

    // Start of scan: entropy-coded data follows and runs to EOI. Everything
    // from here is image content — copy the remainder verbatim and stop.
    if (marker === 0xda) {
      keep.push([i, bytes.length]);
      break;
    }
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push([i, m + 1]);
      i = m + 1;
      continue;
    }
    if (m + 3 > bytes.length) fail("truncated segment length");
    const len = (bytes[m + 1] << 8) | bytes[m + 2];
    if (len < 2) fail(`bad segment length ${len} at offset ${m + 1}`);
    const segEnd = m + 1 + len;
    if (segEnd > bytes.length) fail("segment overruns end of file");
    if (!JPEG_DROP_MARKERS.has(marker)) keep.push([i, segEnd]);
    i = segEnd;
  }
  return concatRanges(bytes, keep);
}

// ---------------------------------------------------------------------------
// PNG — rebuild the chunk stream, dropping metadata chunks.
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// eXIf holds EXIF (incl. GPS) verbatim; the text chunks can hold XMP, which has
// its own geo properties. Colour/gamma chunks are kept — they affect rendering.
const PNG_DROP_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) fail("not a PNG (too short)");
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) fail("not a PNG (bad signature)");
  const keep: Array<[number, number]> = [[0, 8]];
  let i = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (i + 8 <= bytes.length) {
    const len = view.getUint32(i);
    const name = latin1(bytes, i + 4, i + 8);
    const end = i + 12 + len; // length + type + data + crc
    if (len > bytes.length || end > bytes.length) fail(`chunk ${name} overruns end of file`);
    if (!PNG_DROP_CHUNKS.has(name)) keep.push([i, end]);
    i = end;
    if (name === "IEND") break;
  }
  return concatRanges(bytes, keep);
}

// ---------------------------------------------------------------------------
// WebP — RIFF container; drop EXIF/XMP chunks and clear their VP8X flag bits.
// ---------------------------------------------------------------------------

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) fail("not a WebP (too short)");
  if (latin1(bytes, 0, 4) !== "RIFF" || latin1(bytes, 8, 12) !== "WEBP") fail("not a WebP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const end = Math.min(bytes.length, 8 + riffSize);

  const keep: Array<[number, number]> = [[0, 12]];
  let vp8xDataStart = -1;
  let i = 12;
  while (i + 8 <= end) {
    const fourcc = latin1(bytes, i, i + 4);
    const size = view.getUint32(i + 4, true);
    // RIFF chunks are padded to an even length.
    const chunkEnd = i + 8 + size + (size % 2);
    if (chunkEnd > bytes.length) fail(`chunk ${fourcc} overruns end of file`);
    if (fourcc === "EXIF" || fourcc === "XMP ") {
      // dropped
    } else {
      if (fourcc === "VP8X") vp8xDataStart = i + 8;
      keep.push([i, chunkEnd]);
    }
    i = chunkEnd;
  }

  const out = concatRanges(bytes, keep);
  // VP8X advertises which optional chunks exist. Leaving the EXIF/XMP bits set
  // after removing the chunks yields a file some decoders treat as corrupt.
  if (vp8xDataStart >= 0) {
    let written = 0;
    for (const [s, e] of keep) {
      if (vp8xDataStart >= s && vp8xDataStart < e) {
        const flagsAt = written + (vp8xDataStart - s);
        out[flagsAt] &= ~0b0000_1100; // bit3 = EXIF, bit2 = XMP
        break;
      }
      written += e - s;
    }
  }
  // Fix the RIFF payload size to match the rebuilt file.
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(4, out.length - 8, true);
  return out;
}

// ---------------------------------------------------------------------------
// GIF — drop Comment and metadata Application Extension blocks.
// ---------------------------------------------------------------------------

function stripGif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 13 || latin1(bytes, 0, 3) !== "GIF") fail("not a GIF");
  const keep: Array<[number, number]> = [];
  let i = 13; // header + logical screen descriptor

  // Global colour table, if the packed field's MSB is set.
  const packed = bytes[10];
  if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1));
  keep.push([0, i]);

  while (i < bytes.length) {
    const block = bytes[i];
    if (block === 0x3b) {
      keep.push([i, i + 1]); // trailer
      break;
    }
    if (block === 0x21) {
      // Extension: 0x21, label, then sub-blocks.
      const label = bytes[i + 1];
      const blockEnd = skipSubBlocks(bytes, i + 2);
      // 0xFE = Comment. 0xFF = Application; keep NETSCAPE/ANIMEXTS (animation
      // looping is visible behaviour), drop the rest — XMP rides in as an
      // Application Extension with identifier "XMP Data".
      let drop = label === 0xfe;
      if (label === 0xff) {
        const id = latin1(bytes, i + 3, i + 11);
        drop = id !== "NETSCAPE" && id !== "ANIMEXTS";
      }
      if (!drop) keep.push([i, blockEnd]);
      i = blockEnd;
      continue;
    }
    if (block === 0x2c) {
      // Image descriptor (10 bytes) + optional local colour table + LZW data.
      let p = i + 10;
      const lp = bytes[i + 9];
      if (lp & 0x80) p += 3 * (1 << ((lp & 0x07) + 1));
      p += 1; // LZW minimum code size
      p = skipSubBlocks(bytes, p);
      keep.push([i, p]);
      i = p;
      continue;
    }
    fail(`unknown GIF block 0x${block.toString(16)} at offset ${i}`);
  }
  return concatRanges(bytes, keep);
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let p = start;
  while (p < bytes.length) {
    const size = bytes[p];
    if (size === 0) return p + 1;
    p += size + 1;
  }
  fail("truncated GIF sub-block chain");
}

// ---------------------------------------------------------------------------
// HEIC/HEIF — zero the Exif/XMP item payloads IN PLACE.
// ---------------------------------------------------------------------------
//
// A HEIF file stores EXIF as an ITEM: `iinf` declares an item whose type is
// 'Exif', and `iloc` records where that item's bytes sit (normally inside
// `mdat`). Rewriting the container to remove the item would mean recomputing
// every `iloc` offset — and an offset error corrupts the image silently.
//
// So we do not restructure anything. We locate the Exif item's extents and
// overwrite exactly those bytes with zeroes. Every offset in the file stays
// valid, and the coded image item is untouched by construction.
//
// Verified against a real macOS/ImageIO HEIC: iinf declared item_ID=1 'hvc1'
// and item_ID=2 'Exif'; iloc placed Exif at [503,641) and the image at
// [641,688) — adjacent but disjoint, so zeroing the first cannot reach the
// second. The guard below re-proves that per file rather than trusting layout.

function stripHeif(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes); // copy; never mutate the caller's buffer
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const meta = findBox(out, view, 0, out.length, "meta");
  if (!meta) fail("no meta box — not a HEIF file");
  // `meta` is a FullBox: 4 bytes of version/flags before its children.
  const metaChildren = meta.start + 8 + 4;
  const iinf = findBox(out, view, metaChildren, meta.end, "iinf");
  const iloc = findBox(out, view, metaChildren, meta.end, "iloc");
  if (!iinf || !iloc) fail("HEIF meta box has no iinf/iloc");

  const metadataItemIds = readMetadataItemIds(out, view, iinf);
  if (metadataItemIds.size === 0) return out; // nothing to strip

  const extents = readItemExtents(out, view, iloc, metadataItemIds);
  const imageExtents = readItemExtents(out, view, iloc, null, metadataItemIds);

  for (const [off, len] of extents) {
    if (off < 0 || len < 0 || off + len > out.length) fail("item extent outside the file");
    // Guard: refuse to zero anything that overlaps a non-metadata item. If the
    // parse were wrong, this is what stops us blanking the picture.
    for (const [io, il] of imageExtents) {
      if (off < io + il && io < off + len) fail("metadata extent overlaps an image item");
    }
    out.fill(0, off, off + len);
  }
  return out;
}

/** Item IDs whose item_type carries metadata: 'Exif', and 'mime' (XMP). */
function readMetadataItemIds(
  b: Uint8Array,
  view: DataView,
  iinf: { start: number; end: number },
): Set<number> {
  const ids = new Set<number>();
  const version = b[iinf.start + 8];
  let p = iinf.start + 12;
  p += version === 0 ? 2 : 4; // entry_count
  while (p + 8 <= iinf.end) {
    const size = view.getUint32(p);
    const type = latin1(b, p + 4, p + 8);
    if (size < 8 || p + size > iinf.end) break;
    if (type === "infe") {
      const v = b[p + 8];
      // infe v0/v1 use a 16-bit item_ID; v2 also 16-bit, v3 is 32-bit.
      const idIs32 = v >= 3;
      const itemId = idIs32 ? view.getUint32(p + 12) : view.getUint16(p + 12);
      const typeAt = p + 12 + (idIs32 ? 4 : 2) + 2; // + protection_index
      const itemType = latin1(b, typeAt, typeAt + 4);
      if (itemType === "Exif" || itemType === "mime") ids.add(itemId);
    }
    p += size;
  }
  return ids;
}

/**
 * Extents for the requested items. Pass `wanted` to select, or pass null with
 * `excluded` to get every OTHER item's extents (used for the overlap guard).
 */
function readItemExtents(
  b: Uint8Array,
  view: DataView,
  iloc: { start: number; end: number },
  wanted: Set<number> | null,
  excluded?: Set<number>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const version = b[iloc.start + 8];
  let p = iloc.start + 12;
  const sizes = b[p];
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const baseOffsetSize = b[p + 1] >> 4;
  p += 2;
  const count = version < 2 ? view.getUint16(p) : view.getUint32(p);
  p += version < 2 ? 2 : 4;

  const readN = (at: number, n: number): number => {
    if (n === 0) return 0;
    if (n === 4) return view.getUint32(at);
    if (n === 8) return Number(view.getBigUint64(at));
    fail(`unsupported iloc field width ${n}`);
  };

  for (let i = 0; i < count && p < iloc.end; i++) {
    const itemId = version < 2 ? view.getUint16(p) : view.getUint32(p);
    p += version < 2 ? 2 : 4;
    if (version === 1 || version === 2) p += 2; // construction_method
    p += 2; // data_reference_index
    const baseOffset = readN(p, baseOffsetSize);
    p += baseOffsetSize;
    const extentCount = view.getUint16(p);
    p += 2;
    const take = wanted ? wanted.has(itemId) : !excluded?.has(itemId);
    for (let e = 0; e < extentCount; e++) {
      const off = readN(p, offsetSize);
      p += offsetSize;
      const len = readN(p, lengthSize);
      p += lengthSize;
      if (take) out.push([baseOffset + off, len]);
    }
  }
  return out;
}

function findBox(
  b: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  want: string,
): { start: number; end: number } | null {
  let off = start;
  while (off + 8 <= end) {
    const size = view.getUint32(off);
    const type = latin1(b, off + 4, off + 8);
    if (size < 8 || off + size > end) return null;
    if (type === want) return { start: off, end: off + size };
    off += size;
  }
  return null;
}

// ---------------------------------------------------------------------------

function latin1(b: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function concatRanges(b: Uint8Array, ranges: Array<[number, number]>): Uint8Array {
  let total = 0;
  for (const [s, e] of ranges) total += e - s;
  const out = new Uint8Array(total);
  let at = 0;
  for (const [s, e] of ranges) {
    out.set(b.subarray(s, e), at);
    at += e - s;
  }
  return out;
}
