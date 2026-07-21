#!/usr/bin/env node
// Regenerates the GPS-tagged image fixtures in tests/fixtures/images/.
//
// The fixtures are COMMITTED — CI never runs this script, so `npm test` needs
// no image tooling. Run it by hand only when a fixture must change:
//
//   node scripts/make-image-fixtures.mjs
//
// Requires ImageMagick (`magick`) for the base rasters and, for the HEIC
// fixture only, macOS `sips` (ImageIO is the practical way to author a real
// HEIF container). The metadata itself is built here byte-by-byte rather than
// by a tool, so the GPS tags the tests assert on are exactly what we wrote.
//
// Every fixture carries 47°48'0"N 122°30'0"W — deliberately Kingston-adjacent,
// so a leak in a test failure reads as obviously wrong rather than plausible.

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/images");
mkdirSync(OUT, { recursive: true });

const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** A minimal big-endian TIFF block whose only content is a GPS IFD. */
function gpsTiff() {
  const HEADER = 8;
  const IFD0 = 2 + 12 + 4;
  const gpsIfdOff = HEADER + IFD0;
  const GPS_ENTRIES = 4;
  const dataOff = gpsIfdOff + 2 + 12 * GPS_ENTRIES + 4;
  const lat = Buffer.concat([u32be(47), u32be(1), u32be(48), u32be(1), u32be(0), u32be(1)]);
  const lng = Buffer.concat([u32be(122), u32be(1), u32be(30), u32be(1), u32be(0), u32be(1)]);
  const entry = (tag, type, count, val) =>
    Buffer.concat([u16be(tag), u16be(type), u32be(count), val]);
  return Buffer.concat([
    Buffer.from("MM"), u16be(42), u32be(8),
    u16be(1), entry(0x8825, 4, 1, u32be(gpsIfdOff)), u32be(0),
    u16be(GPS_ENTRIES),
    entry(0x0001, 2, 2, Buffer.from([0x4e, 0, 0, 0])),        // GPSLatitudeRef "N"
    entry(0x0002, 5, 3, u32be(dataOff)),                       // GPSLatitude
    entry(0x0003, 2, 2, Buffer.from([0x57, 0, 0, 0])),         // GPSLongitudeRef "W"
    entry(0x0004, 5, 3, u32be(dataOff + lat.length)),          // GPSLongitude
    u32be(0),
    lat, lng,
  ]);
}

const EXIF_PAYLOAD = Buffer.concat([Buffer.from("Exif\0\0"), gpsTiff()]);
const XMP_PACKET = Buffer.from(
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">` +
  `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description ` +
  `xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="47,48.0N" ` +
  `exif:GPSLongitude="122,30.0W"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
);

function magick(args) {
  execFileSync("magick", args, { cwd: OUT, stdio: ["ignore", "ignore", "inherit"] });
}

// --- JPEG: APP1(Exif) + APP1(XMP) + COM, spliced in after SOI --------------
magick(["-size", "64x48", "xc:#3388cc", "base.jpg"]);
{
  const src = readFileSync(path.join(OUT, "base.jpg"));
  const app1Exif = Buffer.concat([Buffer.from([0xff, 0xe1]), u16be(EXIF_PAYLOAD.length + 2), EXIF_PAYLOAD]);
  const xmpPayload = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0"), XMP_PACKET]);
  const app1Xmp = Buffer.concat([Buffer.from([0xff, 0xe1]), u16be(xmpPayload.length + 2), xmpPayload]);
  const comment = Buffer.from("shot at home");
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), u16be(comment.length + 2), comment]);
  writeFileSync(
    path.join(OUT, "gps.jpg"),
    Buffer.concat([src.subarray(0, 2), app1Exif, app1Xmp, com, src.subarray(2)]),
  );
}

// --- PNG: eXIf + tEXt + iTXt(XMP) inserted before IDAT ----------------------
magick(["-size", "64x48", "xc:#3388cc", "base.png"]);
{
  const src = readFileSync(path.join(OUT, "base.png"));
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    return Buffer.concat([u32be(data.length), td, u32be(crc32(td))]);
  };
  // A PNG eXIf chunk holds the raw TIFF block (no "Exif\0\0" prefix).
  const exif = chunk("eXIf", gpsTiff());
  const text = chunk("tEXt", Buffer.concat([Buffer.from("Comment\0"), Buffer.from("shot at home")]));
  const itxt = chunk(
    "iTXt",
    Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0"), XMP_PACKET]),
  );
  // Insert before the first IDAT.
  const idat = src.indexOf(Buffer.from("IDAT")) - 4;
  writeFileSync(
    path.join(OUT, "gps.png"),
    Buffer.concat([src.subarray(0, idat), exif, text, itxt, src.subarray(idat)]),
  );
}

// --- WebP: extended (VP8X) file with EXIF + XMP chunks ----------------------
magick(["-size", "64x48", "xc:#3388cc", "base.webp"]);
{
  const src = readFileSync(path.join(OUT, "base.webp"));
  const body = src.subarray(12); // past "RIFF"+size+"WEBP"
  const pad = (b) => (b.length % 2 ? Buffer.concat([b, Buffer.from([0])]) : b);
  const riffChunk = (fourcc, data) =>
    Buffer.concat([Buffer.from(fourcc), u32le(data.length), pad(data)]);
  // VP8X: flags byte with EXIF(bit3) + XMP(bit2) set, then 24-bit w-1/h-1.
  const vp8x = riffChunk(
    "VP8X",
    Buffer.concat([
      Buffer.from([0b0000_1100, 0, 0, 0]),
      Buffer.from([63, 0, 0]), // width-1  = 63
      Buffer.from([47, 0, 0]), // height-1 = 47
    ]),
  );
  const exif = riffChunk("EXIF", gpsTiff());
  const xmp = riffChunk("XMP ", XMP_PACKET);
  const payload = Buffer.concat([Buffer.from("WEBP"), vp8x, body, exif, xmp]);
  writeFileSync(
    path.join(OUT, "gps.webp"),
    Buffer.concat([Buffer.from("RIFF"), u32le(payload.length), payload]),
  );
}

// --- GIF: Comment Extension + an XMP Application Extension ------------------
magick(["-size", "64x48", "xc:#3388cc", "base.gif"]);
{
  const src = readFileSync(path.join(OUT, "base.gif"));
  const subBlocks = (data) => {
    const parts = [];
    for (let i = 0; i < data.length; i += 255) {
      const slice = data.subarray(i, i + 255);
      parts.push(Buffer.from([slice.length]), slice);
    }
    parts.push(Buffer.from([0]));
    return Buffer.concat(parts);
  };
  const comment = Buffer.concat([Buffer.from([0x21, 0xfe]), subBlocks(Buffer.from("shot at home"))]);
  const xmpExt = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from("XMP DataXMP"),
    subBlocks(XMP_PACKET),
  ]);
  // Insert immediately after the header + logical screen descriptor + GCT.
  const packed = src[10];
  const gctLen = packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  const at = 13 + gctLen;
  writeFileSync(
    path.join(OUT, "gps.gif"),
    Buffer.concat([src.subarray(0, at), comment, xmpExt, src.subarray(at)]),
  );
}

// --- HEIC: let ImageIO build a real HEIF container from the tagged JPEG -----
// ImageIO carries the EXIF across as a proper 'Exif' item declared in iinf and
// located by iloc — which is exactly the structure stripHeif() targets.
if (process.platform === "darwin") {
  execFileSync("sips", ["-s", "format", "heic", "gps.jpg", "--out", "gps.heic"], {
    cwd: OUT,
    stdio: ["ignore", "ignore", "inherit"],
  });
} else if (!existsSync(path.join(OUT, "gps.heic"))) {
  console.warn("! gps.heic not regenerated (needs macOS sips); keeping the committed copy");
}

for (const f of ["base.jpg", "base.png", "base.webp", "base.gif"]) {
  execFileSync("rm", ["-f", path.join(OUT, f)]);
}
console.log(`fixtures written to ${OUT}`);
