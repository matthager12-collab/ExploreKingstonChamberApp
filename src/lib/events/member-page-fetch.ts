// Safe fetch for a member's own events page (docs/adr/ADR-0009).
//
// The url is member-supplied, so this is the SSRF surface. It deliberately does
// NOT go through SOURCE_ALLOWLIST / ingest-http.ts: those fetch a short list of
// sources the Chamber chose, this fetches anything a signed-in member types.
// Containment therefore lives here:
//
//   - https only, port 443 only, no userinfo, <= 500 chars;
//   - the address is checked at CONNECT time inside a custom `lookup`, so a
//     hostname that resolves to a private address (or that rebinds between a
//     pre-check and the connect) never gets a socket. Every address a name
//     resolves to must be public, not just the first;
//   - IP-literal hosts skip DNS entirely, so they are checked up front;
//   - redirects are followed by hand, max 3, each hop re-validated;
//   - 15 s wall clock for the whole chain, body capped at 2 MB, text/html or
//     text/plain only, GET only. Images (fetchMemberImage) ride the same guard:
//     https only, 8 MB cap, jpeg/png/webp/gif only, bytes sniffed, >= 10 KB;
//   - failures come back as a typed result with a fixed member-safe message —
//     never raw error text and never any part of a response body.
//
// Node stdlib only: no undici, no new dependency.

import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import type { IncomingMessage } from "node:http";

export const MAX_URL_LENGTH = 500;
export const MAX_REDIRECTS = 3;
export const TOTAL_TIMEOUT_MS = 15_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_CHARS = 30_000;
const USER_AGENT = "visit-kingston-member-events/1.0 (Greater Kingston Chamber tourism app)";

export type FetchFailure = "not-allowed" | "unreachable" | "too-large" | "too-small" | "bad-type";

const MESSAGES: Record<FetchFailure, string> = {
  "not-allowed": "That link isn't allowed",
  unreachable: "We couldn't reach that page",
  "too-large": "That page is too large",
  "bad-type": "That link isn't a web page we can read",
  "too-small": "That image is too small",
};

export type PageFetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; code: FetchFailure; message: string };

function fail(code: FetchFailure): PageFetchResult {
  return { ok: false, code, message: MESSAGES[code] };
}

// ---- address policy -------------------------------------------------------

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net4, prefix, "ipv4");
}
blocked.addAddress("255.255.255.255", "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local
blocked.addSubnet("fe80::", 10, "ipv6"); // link local
// IPv4-mapped (::ffff:0:0/96) is refused in isPublicAddress, not here: node's
// BlockList treats every IPv4 address as mapped, so a rule for it blocks all of IPv4.
// Forms that can smuggle an embedded IPv4 past a v6 rule.
blocked.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64
blocked.addSubnet("2002::", 16, "ipv6"); // 6to4
blocked.addSubnet("2001::", 32, "ipv6"); // Teredo

/** True only for a syntactically valid IP that is not in a refused range. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  // Whole mapped /96 refused rather than unwrapped: a DNS answer has no business
  // being a mapped address, and unwrapping is where bugs live. URL normalises
  // every spelling (dotted, hex, zero-padded) to one form.
  if (family === 6 && new URL(`http://[${address}]`).hostname.startsWith("[::ffff:")) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

// ---- url policy -----------------------------------------------------------

/** Parse and vet a member-supplied url. Null means "not allowed". */
export function parseMemberPageUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.port !== "" && u.port !== "443") return null;
  if (u.username !== "" || u.password !== "") return null;
  if (u.hostname === "") return null;
  // URL.hostname brackets IPv6 literals; strip them before testing.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // Literals never reach `lookup`, so they are judged here.
  if (net.isIP(host) !== 0 && !isPublicAddress(host)) return null;
  return u;
}

// ---- connect-time address check ------------------------------------------

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;
type BaseLookup = (
  hostname: string,
  options: dns.LookupAllOptions,
  cb: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

/**
 * A `lookup` for https.request that refuses to connect unless EVERY resolved
 * address is public. Running at connect time is what defeats DNS rebinding:
 * the address checked is the address the socket opens.
 */
export function makeGuardedLookup(base: BaseLookup = dns.lookup as unknown as BaseLookup) {
  return (hostname: string, options: dns.LookupOptions, cb: LookupCallback): void => {
    base(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, "");
      if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
        const e: NodeJS.ErrnoException = new Error("blocked address");
        e.code = "EBLOCKED";
        return cb(e, "");
      }
      if (options.all) return cb(null, addresses);
      cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

// ---- fetch ----------------------------------------------------------------

export interface FetchDeps {
  request?: typeof https.request;
  lookup?: ReturnType<typeof makeGuardedLookup>;
}

/** What one guarded GET will accept. */
interface GetPolicy {
  accept: string;
  typeOk: (contentType: string) => boolean;
  maxBytes: number;
}

type Hop =
  | { kind: "body"; bytes: Buffer; type: string }
  | { kind: "redirect"; location: string }
  | { kind: "fail"; code: FetchFailure };

function oneHop(
  url: URL,
  deadline: number,
  deps: Required<FetchDeps>,
  signal: { cancelled: boolean; abort?: () => void },
  policy: GetPolicy,
): Promise<Hop> {
  return new Promise<Hop>((resolve) => {
    let settled = false;
    const done = (h: Hop) => {
      if (settled) return;
      settled = true;
      resolve(h);
    };

    const remaining = deadline - Date.now();
    if (remaining <= 0) return done({ kind: "fail", code: "unreachable" });

    const req = deps.request({
      protocol: "https:",
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      agent: false,
      lookup: deps.lookup as never,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: policy.accept,
        "Accept-Encoding": "identity",
      },
    });
    signal.abort = () => req.destroy();
    if (signal.cancelled) req.destroy();

    req.on("error", () => done({ kind: "fail", code: "unreachable" }));
    req.on("response", (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = res.headers.location;
        res.resume();
        return done(
          location ? { kind: "redirect", location } : { kind: "fail", code: "unreachable" },
        );
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return done({ kind: "fail", code: "unreachable" });
      }
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      if (!policy.typeOk(type)) {
        res.destroy();
        return done({ kind: "fail", code: "bad-type" });
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > policy.maxBytes) {
        res.destroy();
        return done({ kind: "fail", code: "too-large" });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > policy.maxBytes) {
          res.destroy();
          req.destroy();
          return done({ kind: "fail", code: "too-large" });
        }
        chunks.push(chunk);
      });
      res.on("end", () => done({ kind: "body", bytes: Buffer.concat(chunks), type }));
      res.on("error", () => done({ kind: "fail", code: "unreachable" }));
      res.on("close", () => done({ kind: "fail", code: "unreachable" })); // no-op if already settled
    });
    req.end();
  });
}

type GetResult =
  | { ok: true; bytes: Buffer; type: string; finalUrl: string }
  | { ok: false; code: FetchFailure };

/** The one guarded GET behind both the page and image fetches: same url policy,
 *  connect-time address check, hand-followed redirects and 15 s wall clock. */
async function guardedGet(rawUrl: string, deps: FetchDeps, policy: GetPolicy): Promise<GetResult> {
  const resolved: Required<FetchDeps> = {
    request: deps.request ?? https.request,
    lookup: deps.lookup ?? makeGuardedLookup(),
  };
  let current = parseMemberPageUrl(rawUrl);
  if (!current) return { ok: false, code: "not-allowed" };

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const signal: { cancelled: boolean; abort?: () => void } = { cancelled: false };
  // One timer for the whole chain, redirects included.
  const timer = setTimeout(() => {
    signal.cancelled = true;
    signal.abort?.();
  }, TOTAL_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const result = await oneHop(current, deadline, resolved, signal, policy);
      if (result.kind === "body") {
        return { ok: true, bytes: result.bytes, type: result.type, finalUrl: current.toString() };
      }
      if (result.kind === "fail") return { ok: false, code: result.code };
      // redirect: resolve relative to where we are, then re-vet like a new url
      let next: URL | null = null;
      try {
        next = parseMemberPageUrl(new URL(result.location, current).toString());
      } catch {
        next = null;
      }
      if (!next) return { ok: false, code: "not-allowed" };
      current = next;
    }
    return { ok: false, code: "unreachable" }; // more than MAX_REDIRECTS hops
  } catch {
    return { ok: false, code: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const PAGE_POLICY: GetPolicy = {
  accept: "text/html, text/plain;q=0.9",
  typeOk: (t) => /^\s*(text\/html|text\/plain)\b/.test(t),
  maxBytes: MAX_BODY_BYTES,
};

/** Fetch one member-supplied page. Never throws; never echoes raw errors.
 *  `finalUrl` is where the redirects ended: the base for relative links and images. */
export async function fetchMemberPage(rawUrl: string, deps: FetchDeps = {}): Promise<PageFetchResult> {
  const r = await guardedGet(rawUrl, deps, PAGE_POLICY);
  if (!r.ok) return fail(r.code);
  return { ok: true, html: new TextDecoder("utf-8").decode(r.bytes), finalUrl: r.finalUrl };
}

// ---- image fetch ----------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** What the bytes really are, from their magic numbers. Never SVG. */
function sniffImageType(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Icons, spacers and tracking pixels are smaller than any real flyer. */
export const MIN_IMAGE_BYTES = 10 * 1024;

export type ImageFetchResult =
  | { ok: true; bytes: Uint8Array; ext: string }
  | { ok: false; code: FetchFailure };

const IMAGE_POLICY: GetPolicy = {
  accept: "image/jpeg, image/png, image/webp, image/gif",
  typeOk: (t) => t.split(";")[0].trim() in IMAGE_TYPES,
  maxBytes: MAX_IMAGE_BYTES,
};

/** Fetch one image a member's page shows. Same SSRF rules as the page fetch
 *  (https only, connect-time public-address check, vetted redirects). The
 *  declared type must be an allowed raster type AND the bytes must really be
 *  that type; under 10 KB is refused. Never throws. */
export async function fetchMemberImage(rawUrl: string, deps: FetchDeps = {}): Promise<ImageFetchResult> {
  const r = await guardedGet(rawUrl, deps, IMAGE_POLICY);
  if (!r.ok) return r;
  const declared = r.type.split(";")[0].trim();
  if (sniffImageType(r.bytes) !== declared) return { ok: false, code: "bad-type" };
  if (r.bytes.length < MIN_IMAGE_BYTES) return { ok: false, code: "too-small" };
  return { ok: true, bytes: new Uint8Array(r.bytes), ext: IMAGE_TYPES[declared] };
}

// ---- html -> text ---------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

const MAX_LINK_LENGTH = 500;
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const IMG = /<img\b([^>]*)>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** No whitespace, angle or square brackets: the link must survive as `text [url]` unambiguously. */
const SAFE_LINK = /^https?:\/\/[^\s<>[\]]+$/i;
/** SVG is never artwork (script vector); the rest is one cheap filter for obvious
 *  non-artwork. The 10 KB size floor is the real one. */
const SKIP_IMAGE = /\.svg$|logo|spacer|pixel|sprite|favicon|tracking/i;

/** Attribute value (decoded) from a tag's attribute string, or undefined. */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  const raw = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return raw === undefined ? undefined : decodeEntities(raw.trim());
}

/** An absolute http(s) url for `raw` (resolved against `base` when relative), or null. */
function resolveHttp(raw: string, base?: string): string | null {
  if (raw.length === 0 || raw.length > MAX_LINK_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const href = u.toString();
  return href.length <= MAX_LINK_LENGTH && SAFE_LINK.test(href) ? href : null;
}

/** The absolute http(s) href of an anchor's attributes, or null. */
function anchorHref(attrs: string, base?: string): string | null {
  const raw = HREF.exec(attrs);
  const value = raw ? (raw[1] ?? raw[2] ?? raw[3]) : undefined;
  return value === undefined ? null : resolveHttp(decodeEntities(value.trim()), base);
}

/** The img's own url (src, else lazy-load data-src, else srcset's first), or null.
 *  Only https images are ever fetched, but http ones are still listed so the
 *  page text stays honest; the fetch refuses them. */
function imageUrls(attrs: string, base?: string): { shown: string; all: string[] } | null {
  const srcset = attr(attrs, "srcset")?.split(",")[0].trim().split(/\s+/)[0];
  const all = [attr(attrs, "src"), attr(attrs, "data-src"), srcset]
    .filter((v): v is string => !!v && !/^data:/i.test(v))
    .map((v) => resolveHttp(v, base))
    .filter((v): v is string => !!v && !SKIP_IMAGE.test(new URL(v).pathname));
  return all.length ? { shown: all[0], all } : null;
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

/**
 * Every absolute http(s) link on the page, exactly as htmlToText prints it.
 * The server uses this to accept a model-returned url only if the page really
 * carried it. Relative hrefs resolve against `baseUrl`.
 */
export function extractLinks(html: string, baseUrl?: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripNoise(html).matchAll(ANCHOR)) {
    const href = anchorHref(m[1], baseUrl);
    if (href) out.add(href);
  }
  return out;
}

/** Every image url on the page that htmlToText may print as `[image: url "alt"]`
 *  (img src / data-src / first srcset url). The server accepts a model-returned
 *  imageUrl only if it is in this set. */
export function extractImages(html: string, baseUrl?: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripNoise(html).matchAll(IMG)) {
    for (const u of imageUrls(m[1], baseUrl)?.all ?? []) out.add(u);
  }
  return out;
}

/** Entity-escape `&` so the final decodeEntities pass hands back exactly `s`. */
const esc = (s: string) => s.replace(/&/g, "&amp;");

/**
 * Page html -> plain text for the model. Regex is enough because the output is
 * only ever handed to the model as inert text; it is never rendered as html.
 * An anchor with an http(s) href prints as `text [href]` (relative hrefs are
 * resolved against `baseUrl`); every other anchor keeps its text and loses its
 * href. An image prints as `[image: url "alt"]` where it sits.
 */
export function htmlToText(html: string, baseUrl?: string): string {
  const text = stripNoise(html)
    .replace(ANCHOR, (_m, attrs: string, inner: string) => {
      const href = anchorHref(attrs, baseUrl);
      return href ? `${inner} [${esc(href)}] ` : inner;
    })
    .replace(IMG, (_m, attrs: string) => {
      const img = imageUrls(attrs, baseUrl);
      if (!img) return " ";
      const alt = (attr(attrs, "alt") ?? "").replace(/["<>[\]]/g, "'").replace(/\s+/g, " ").trim().slice(0, 100);
      return `\n[image: ${esc(img.shown)} "${esc(alt)}"]\n`;
    })
    // block-ish tags become line breaks so headings and times stay on their own lines
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section|article|header|footer|table|time)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}
