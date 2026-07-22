/*
 * QR Code generator (byte mode) — a self-contained TypeScript port of
 * Project Nayuki's reference "QR Code generator library".
 *
 * VENDORED by E22 (docs/KIOSK.md §3): a kiosk must never call a hosted QR
 * service (CSP self-containment) and must not open a third-party site, so the
 * encoder ships in-repo with no dependencies and no network calls. It is
 * deterministic — the same text always produces the same modules — which is
 * what tests/unit/qr-encoder.test.ts pins with known vectors.
 *
 * Scope trimmed to what the kiosk needs: byte segments only (URLs and tel:
 * links are all ASCII/UTF-8), automatic version selection, all four ECC levels,
 * automatic mask selection. Kanji/alphanumeric/numeric optimisation and manual
 * masking from the full library are intentionally omitted.
 *
 * ---------------------------------------------------------------------------
 * Original work Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising
 *   from, out of or in connection with the Software or the use or other
 *   dealings in the Software.
 * ---------------------------------------------------------------------------
 */

/**
 * Error-correction level: higher recovers more damage at the cost of capacity.
 *
 * A const object rather than a TS `enum` on purpose. An enum is not erasable
 * syntax — it emits a runtime object — so it cannot be loaded by Node's
 * type-stripping, which is exactly how this module is round-trip verified
 * against an independent decoder outside the Next build.
 */
export const Ecc = {
  LOW: 0,
  MEDIUM: 1,
  QUARTILE: 2,
  HIGH: 3,
} as const;
export type Ecc = (typeof Ecc)[keyof typeof Ecc];

/** Format-info bits per ECC level — NOT the same order as the level values. */
const ECC_FORMAT_BITS: Record<Ecc, number> = {
  [Ecc.LOW]: 1,
  [Ecc.MEDIUM]: 0,
  [Ecc.QUARTILE]: 3,
  [Ecc.HIGH]: 2,
};

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// Per-version, per-ECC error-correction codewords and block counts (QR spec).
// Index [ecc][version], version 1..40 stored at index 1..40 (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  // LOW
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // MEDIUM
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // QUARTILE
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // HIGH
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  // LOW
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // MEDIUM
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // QUARTILE
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // HIGH
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver: number, ecc: Ecc): number {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc][ver]
  );
}

/* ── Reed-Solomon over GF(256), primitive polynomial 0x11D ─────────────── */

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= reedSolomonMultiply(coef, factor);
    });
  }
  return result;
}

/* ── Bit buffer ─────────────────────────────────────────────────────────── */

function appendBits(value: number, len: number, bb: number[]): void {
  for (let i = len - 1; i >= 0; i--) bb.push((value >>> i) & 1);
}

/* ── The matrix builder ─────────────────────────────────────────────────── */

/** A finished QR symbol: `size` modules per side, `get(x,y)` returns dark. */
export interface QrMatrix {
  size: number;
  version: number;
  ecc: Ecc;
  mask: number;
  get(x: number, y: number): boolean;
  /** Row-major boolean grid, cloned — safe for the caller to keep. */
  toRows(): boolean[][];
}

/**
 * Encode `text` (UTF-8, byte mode) at the smallest version that fits it at the
 * given minimum ECC, boosting ECC for free if a higher level still fits.
 */
export function encodeQr(text: string, minEcc: Ecc = Ecc.MEDIUM): QrMatrix {
  const data = utf8Bytes(text);

  // Pick the smallest version whose data capacity holds this segment.
  let version = MIN_VERSION;
  let dataUsedBits = 0;
  for (; ; version++) {
    if (version > MAX_VERSION) {
      throw new RangeError("Data too long for a single QR symbol");
    }
    const capacityBits = getNumDataCodewords(version, minEcc) * 8;
    // Byte-mode header: 4 mode bits + char-count field (8 bits for v1-9, else
    // 16) + 8 bits per byte.
    const charCountBits = version <= 9 ? 8 : 16;
    const usedBits = 4 + charCountBits + data.length * 8;
    if (usedBits <= capacityBits) {
      dataUsedBits = usedBits;
      break;
    }
  }

  // Boost the ECC level as high as still fits at this chosen version — free
  // resilience, exactly as the reference library does.
  let ecc = minEcc;
  for (const candidate of [Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH]) {
    if (candidate > minEcc && dataUsedBits <= getNumDataCodewords(version, candidate) * 8) {
      ecc = candidate;
    }
  }

  // Build the data bit stream: mode indicator (0b0100 = byte), char count, data.
  const bb: number[] = [];
  appendBits(0x4, 4, bb);
  appendBits(data.length, version <= 9 ? 8 : 16, bb);
  for (const b of data) appendBits(b, 8, bb);

  // Terminator + byte alignment + pad codewords (0xEC, 0x11 alternating).
  const dataCapacityBits = getNumDataCodewords(version, ecc) * 8;
  appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
  appendBits(0, (8 - (bb.length % 8)) % 8, bb);
  for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(pad, 8, bb);
  }

  // Pack bits into codewords.
  const dataCodewords = new Array(bb.length >>> 3).fill(0);
  bb.forEach((bit, i) => {
    dataCodewords[i >>> 3] |= bit << (7 - (i & 7));
  });

  const allCodewords = addEccAndInterleave(dataCodewords, version, ecc);
  return buildMatrix(allCodewords, version, ecc);
}

function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

function addEccAndInterleave(data: number[], version: number, ecc: Ecc): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const block = dat.slice();
    const eccBytes = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) block.push(0); // placeholder so columns align
    block.push(...eccBytes);
    blocks.push(block);
  }

  // Interleave: take column 0 of every block, then column 1, and so on. The
  // planted placeholder at index shortBlockLen-blockEccLen in short blocks is
  // skipped so the streams line up.
  const result: number[] = [];
  const maxLen = blocks.reduce((m, b) => Math.max(m, b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(block[i]);
      }
    });
  }
  return result;
}

function buildMatrix(codewords: number[], version: number, ecc: Ecc): QrMatrix {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Finder patterns (+ separators) at three corners.
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          setFn(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Alignment patterns.
  const alignPositions = alignmentPatternPositions(version);
  const numAlign = alignPositions.length;
  for (let i = 0; i < numAlign; i++) {
    for (let j = 0; j < numAlign; j++) {
      // Skip the three that overlap the finder patterns.
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === numAlign - 1) ||
        (i === numAlign - 1 && j === 0)
      ) {
        continue;
      }
      const cx = alignPositions[i];
      const cy = alignPositions[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve format (and, for v>=7, version) areas so the data walk skips them.
  drawFormatBits(ecc, 0, size, setFn); // provisional; rewritten after masking
  drawVersion(version, size, setFn);

  // Zig-zag data placement.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const x = right - k;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  // Try all eight masks, keep the lowest-penalty one.
  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFunction, mask);
    drawFormatBits(ecc, mask, size, (x, y, dark) => {
      modules[y][x] = dark;
    });
    const penalty = penaltyScore(modules, size);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
    }
    applyMask(modules, isFunction, mask); // XOR again to undo
  }
  applyMask(modules, isFunction, bestMask);
  drawFormatBits(ecc, bestMask, size, (x, y, dark) => {
    modules[y][x] = dark;
  });

  return {
    size,
    version,
    ecc,
    mask: bestMask,
    get: (x, y) => modules[y][x],
    toRows: () => modules.map((row) => row.slice()),
  };
}

/**
 * Alignment-pattern centres for a version (ISO/IEC 18004 Annex E).
 *
 * THE ceil AND THE VERSION-32 CASE ARE BOTH LOAD-BEARING. An earlier draft of
 * this port used Math.floor here and omitted the special case, which put the
 * LARGE gap first instead of last and so misplaced every alignment pattern on
 * 15 of the 40 versions (15, 16, 18, 19, 22, 24, 26, 28, 30, 31, 33, 36, 37,
 * 39, 40). The symbol still renders as a confident-looking square; a decoder
 * simply cannot read it, because it looks for the patterns where the spec says
 * they are and the zig-zag data walk skips a different set of modules than the
 * decoder does.
 *
 * That bug was invisible to everything guarding this file: the pinned test
 * vectors are versions 2 and 4, and the development round-trip through an
 * independent decoder topped out at version 11 — all below the first divergent
 * version. It is reachable in production through any member-supplied URL long
 * enough to need version 15 (259 bytes at QUARTILE), e.g. a booking link
 * pasted from an address bar with its full tracking query intact. Hence
 * tests/unit/qr-encoder.test.ts now checks the positions for ALL 40 versions
 * structurally, rather than trusting a sample.
 *
 * Version 32 is the spec's one genuine anomaly, where the even-spacing rule
 * does not produce the tabulated value; the reference library special-cases it
 * and so does this.
 */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function drawFormatBits(
  ecc: Ecc,
  mask: number,
  size: number,
  set: (x: number, y: number, dark: boolean) => void,
): void {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) set(8, i, ((bits >>> i) & 1) !== 0);
  set(8, 7, ((bits >>> 6) & 1) !== 0);
  set(8, 8, ((bits >>> 7) & 1) !== 0);
  set(7, 8, ((bits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) set(14 - i, 8, ((bits >>> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, ((bits >>> i) & 1) !== 0);
  set(8, size - 8, true); // always-dark module
}

function drawVersion(
  version: number,
  size: number,
  set: (x: number, y: number, dark: boolean) => void,
): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    set(a, b, dark);
    set(b, a, dark);
  }
}

function applyMask(modules: boolean[][], isFunction: boolean[][], mask: number): void {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: throw new Error("unreachable");
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

function penaltyScore(modules: boolean[][], size: number): number {
  let result = 0;
  const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

  // Rule 1: runs of 5+ same-colour modules in each row and column.
  for (let y = 0; y < size; y++) {
    let run = 0;
    let colour = false;
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === colour) {
        run++;
        if (run === 5) result += N1;
        else if (run > 5) result++;
      } else {
        colour = modules[y][x];
        run = 1;
      }
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 0;
    let colour = false;
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === colour) {
        run++;
        if (run === 5) result += N1;
        else if (run > 5) result++;
      } else {
        colour = modules[y][x];
        run = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of the same colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += N2;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns in rows and columns.
  const pattern = [true, false, true, true, true, false, true];
  const matches = (arr: boolean[], x: number): boolean => {
    for (let k = 0; k < 7; k++) if (arr[x + k] !== pattern[k]) return false;
    const before = x - 4 >= 0 ? arr.slice(x - 4, x).every((v) => !v) : false;
    const afterStart = x + 7;
    const after = afterStart + 4 <= arr.length ? arr.slice(afterStart, afterStart + 4).every((v) => !v) : false;
    return before || after;
  };
  for (let y = 0; y < size; y++) {
    const row = modules[y];
    for (let x = 0; x + 7 <= size; x++) if (matches(row, x)) result += N3;
  }
  for (let x = 0; x < size; x++) {
    const col = modules.map((r) => r[x]);
    for (let y = 0; y + 7 <= size; y++) if (matches(col, y)) result += N3;
  }

  // Rule 4: balance of dark vs light modules.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const total = size * size;
  const k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
  result += k * N4;

  return result;
}
