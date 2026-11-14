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
//     text/plain only, GET only;
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

export type FetchFailure = "not-allowed" | "unreachable" | "too-large" | "bad-type";

const MESSAGES: Record<FetchFailure, string> = {
  "not-allowed": "That link isn't allowed",
  unreachable: "We couldn't reach that page",
  "too-large": "That page is too large",
  "bad-type": "That link isn't a web page we can read",
};

export type PageFetchResult =
  | { ok: true; html: string }
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
// IPv4-mapped. The whole /96 is refused rather than unwrapped: a DNS answer
// has no business being a mapped address, and unwrapping is where bugs live.
blocked.addSubnet("::ffff:0:0", 96, "ipv6");
// Forms that can smuggle an embedded IPv4 past a v6 rule.
blocked.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64
blocked.addSubnet("2002::", 16, "ipv6"); // 6to4
blocked.addSubnet("2001::", 32, "ipv6"); // Teredo

/** True only for a syntactically valid IP that is not in a refused range. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
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

type Hop =
  | { kind: "body"; html: string }
  | { kind: "redirect"; location: string }
  | { kind: "fail"; code: FetchFailure };

function oneHop(
  url: URL,
  deadline: number,
  deps: Required<FetchDeps>,
  signal: { cancelled: boolean; abort?: () => void },
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
        Accept: "text/html, text/plain;q=0.9",
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
      if (!/^\s*(text\/html|text\/plain)\b/.test(type)) {
        res.destroy();
        return done({ kind: "fail", code: "bad-type" });
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        res.destroy();
        return done({ kind: "fail", code: "too-large" });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.destroy();
          req.destroy();
          return done({ kind: "fail", code: "too-large" });
        }
        chunks.push(chunk);
      });
      res.on("end", () =>
        done({ kind: "body", html: new TextDecoder("utf-8").decode(Buffer.concat(chunks)) }),
      );
      res.on("error", () => done({ kind: "fail", code: "unreachable" }));
      res.on("close", () => done({ kind: "fail", code: "unreachable" })); // no-op if already settled
    });
    req.end();
  });
}

/** Fetch one member-supplied page. Never throws; never echoes raw errors. */
export async function fetchMemberPage(rawUrl: string, deps: FetchDeps = {}): Promise<PageFetchResult> {
  const resolved: Required<FetchDeps> = {
    request: deps.request ?? https.request,
    lookup: deps.lookup ?? makeGuardedLookup(),
  };
  let current = parseMemberPageUrl(rawUrl);
  if (!current) return fail("not-allowed");

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const signal: { cancelled: boolean; abort?: () => void } = { cancelled: false };
  // One timer for the whole chain, redirects included.
  const timer = setTimeout(() => {
    signal.cancelled = true;
    signal.abort?.();
  }, TOTAL_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const result = await oneHop(current, deadline, resolved, signal);
      if (result.kind === "body") return { ok: true, html: result.html };
      if (result.kind === "fail") return fail(result.code);
      // redirect: resolve relative to where we are, then re-vet like a new url
      let next: URL | null = null;
      try {
        next = parseMemberPageUrl(new URL(result.location, current).toString());
      } catch {
        next = null;
      }
      if (!next) return fail("not-allowed");
      current = next;
    }
    return fail("unreachable"); // more than MAX_REDIRECTS hops
  } catch {
    return fail("unreachable");
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Page html -> plain text for the model. Regex is enough because the output is
 * only ever handed to the model as inert text; it is never rendered as html.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    // block-ish tags become line breaks so headings and times stay on their own lines
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section|article|header|footer|table|time)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}
