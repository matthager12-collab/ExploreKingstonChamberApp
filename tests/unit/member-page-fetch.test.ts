// SSRF guard + html->text for member-saved events pages (ADR-0009).
// No network: https.request and dns are replaced by fakes that still run the
// guarded `lookup`, exactly as the real socket would at connect time.

import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  fetchMemberPage,
  htmlToText,
  isPublicAddress,
  makeGuardedLookup,
  MAX_BODY_BYTES,
  parseMemberPageUrl,
} from "@/lib/events/member-page-fetch";

describe("parseMemberPageUrl", () => {
  it.each([
    ["http scheme", "http://example.com/events"],
    ["non-443 port", "https://example.com:8443/events"],
    ["userinfo", "https://user:pw@example.com/events"],
    ["username only", "https://user@example.com/"],
    ["private IPv4 literal", "https://10.1.2.3/"],
    ["loopback literal", "https://127.0.0.1/"],
    ["metadata literal", "https://169.254.169.254/latest/meta-data"],
    ["decimal-encoded loopback", "https://2130706433/"],
    ["IPv6 loopback literal", "https://[::1]/"],
    ["IPv4-mapped literal", "https://[::ffff:127.0.0.1]/"],
    ["too long", "https://example.com/" + "a".repeat(500)],
    ["not a url", "example.com/events"],
    ["ftp", "ftp://example.com/"],
  ])("rejects %s", (_n, raw) => {
    expect(parseMemberPageUrl(raw)).toBeNull();
  });

  it("accepts a plain https url, with or without :443", () => {
    expect(parseMemberPageUrl("https://example.com/live-music")).not.toBeNull();
    expect(parseMemberPageUrl("https://example.com:443/live-music")).not.toBeNull();
    expect(parseMemberPageUrl("https://93.184.216.34/")).not.toBeNull();
  });
});

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
    "172.31.255.255", "192.0.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "240.0.0.1",
    "255.255.255.255", "::", "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1",
    "::ffff:7f00:1", "64:ff9b::7f00:1", "not-an-ip",
  ])("refuses %s", (a) => expect(isPublicAddress(a)).toBe(false));

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])(
    "allows %s",
    (a) => expect(isPublicAddress(a)).toBe(true),
  );
});

// ---- fakes -----------------------------------------------------------------

type Reply = { status: number; headers?: Record<string, string>; chunks?: Buffer[] };

/** A fake https.request. `dnsFor` maps hostname -> resolved addresses. */
function fakes(replies: Record<string, Reply>, dnsFor: Record<string, string[]>) {
  const seen: string[] = [];
  const lookup = makeGuardedLookup((host, _opts, cb) => {
    const addrs = dnsFor[host];
    if (!addrs) return cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
    cb(null, addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  });
  const request = ((options: { hostname: string; path: string; method: string; lookup: typeof lookup }) => {
    seen.push(`${options.method} ${options.hostname}${options.path}`);
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const req = {
      on(ev: string, fn: (arg?: unknown) => void) {
        handlers[ev] = fn;
        return req;
      },
      destroy() {},
      end() {
        const respond = () => {
          const r = replies[options.hostname];
          if (!r) return handlers.error?.(new Error("no reply"));
          const res = Readable.from(r.chunks ?? []) as Readable & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = r.status;
          res.headers = r.headers ?? {};
          handlers.response?.(res);
        };
        if (net.isIP(options.hostname)) return respond(); // literals skip DNS, as in node
        options.lookup(options.hostname, {}, (err) => (err ? handlers.error?.(err) : respond()));
      },
    };
    return req;
  }) as never;
  return { request, lookup, seen };
}

const HTML = { "content-type": "text/html; charset=utf-8" };

describe("fetchMemberPage", () => {
  it("fetches a public page", async () => {
    const f = fakes(
      { "example.com": { status: 200, headers: HTML, chunks: [Buffer.from("<p>hi</p>")] } },
      { "example.com": ["93.184.216.34"] },
    );
    const r = await fetchMemberPage("https://example.com/events", f);
    expect(r).toEqual({ ok: true, html: "<p>hi</p>" });
    expect(f.seen).toEqual(["GET example.com/events"]);
  });

  it.each([
    ["127.0.0.1", ["127.0.0.1"]],
    ["10.x", ["10.4.5.6"]],
    ["metadata", ["169.254.169.254"]],
    ["::1", ["::1"]],
    ["one bad address among good ones", ["93.184.216.34", "10.0.0.1"]],
  ])("refuses a hostname that resolves to %s, at connect time", async (_n, addrs) => {
    const f = fakes(
      { "evil.test": { status: 200, headers: HTML, chunks: [Buffer.from("secret")] } },
      { "evil.test": addrs },
    );
    const r = await fetchMemberPage("https://evil.test/", f);
    expect(r).toEqual({ ok: false, code: "unreachable", message: "We couldn't reach that page" });
  });

  it("rejects http:, bad ports, userinfo and private literals before any request", async () => {
    const f = fakes({}, {});
    for (const u of [
      "http://example.com/",
      "https://example.com:444/",
      "https://a:b@example.com/",
      "https://192.168.0.1/",
    ]) {
      expect(await fetchMemberPage(u, f)).toEqual({
        ok: false,
        code: "not-allowed",
        message: "That link isn't allowed",
      });
    }
    expect(f.seen).toEqual([]);
  });

  it("follows a redirect to another public host", async () => {
    const f = fakes(
      {
        "a.test": { status: 301, headers: { location: "https://b.test/new" } },
        "b.test": { status: 200, headers: HTML, chunks: [Buffer.from("ok")] },
      },
      { "a.test": ["93.184.216.34"], "b.test": ["93.184.216.35"] },
    );
    expect(await fetchMemberPage("https://a.test/", f)).toEqual({ ok: true, html: "ok" });
    expect(f.seen).toEqual(["GET a.test/", "GET b.test/new"]);
  });

  it.each([
    ["a private literal", "https://10.0.0.5/admin"],
    ["http", "http://b.test/"],
    ["another port", "https://b.test:8443/"],
    ["a name that resolves privately", "https://internal.test/"],
  ])("refuses a redirect to %s", async (_n, target) => {
    const f = fakes(
      { "a.test": { status: 302, headers: { location: target } } },
      { "a.test": ["93.184.216.34"], "internal.test": ["10.0.0.9"], "b.test": ["93.184.216.35"] },
    );
    const r = await fetchMemberPage("https://a.test/", f);
    expect(r.ok).toBe(false);
    expect(f.seen).not.toContain("GET 10.0.0.5/admin");
    // (internal.test is "attempted" in the fake, but its lookup refuses, so no body is ever read.)
  });

  it("gives up after 3 redirects", async () => {
    const replies: Record<string, Reply> = {};
    const dns: Record<string, string[]> = {};
    for (const h of ["a", "b", "c", "d", "e"]) {
      replies[`${h}.test`] = { status: 302, headers: { location: `https://${String.fromCharCode(h.charCodeAt(0) + 1)}.test/` } };
      dns[`${h}.test`] = ["93.184.216.34"];
    }
    const f = fakes(replies, dns);
    const r = await fetchMemberPage("https://a.test/", f);
    expect(r.ok).toBe(false);
    expect(f.seen).toHaveLength(4); // the original + 3 redirects
  });

  it("aborts an oversize body", async () => {
    const big = Buffer.alloc(MAX_BODY_BYTES / 2 + 1, 97);
    const f = fakes(
      { "big.test": { status: 200, headers: HTML, chunks: [big, big] } },
      { "big.test": ["93.184.216.34"] },
    );
    expect(await fetchMemberPage("https://big.test/", f)).toEqual({
      ok: false,
      code: "too-large",
      message: "That page is too large",
    });
  });

  it("refuses an oversize declared length and non-text types", async () => {
    const f = fakes(
      {
        "len.test": { status: 200, headers: { ...HTML, "content-length": String(MAX_BODY_BYTES + 1) } },
        "pdf.test": { status: 200, headers: { "content-type": "application/pdf" }, chunks: [Buffer.from("%PDF")] },
      },
      { "len.test": ["93.184.216.34"], "pdf.test": ["93.184.216.34"] },
    );
    expect((await fetchMemberPage("https://len.test/", f)) as { code: string }).toMatchObject({ code: "too-large" });
    expect((await fetchMemberPage("https://pdf.test/", f)) as { code: string }).toMatchObject({ code: "bad-type" });
  });

  it("never echoes a response body on an error status", async () => {
    const f = fakes(
      { "e.test": { status: 500, headers: HTML, chunks: [Buffer.from("SECRET STACK TRACE")] } },
      { "e.test": ["93.184.216.34"] },
    );
    const r = await fetchMemberPage("https://e.test/", f);
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("htmlToText", () => {
  const html = readFileSync(path.resolve(__dirname, "../fixtures/member-page/live-music.html"), "utf8");
  const text = htmlToText(html);

  it("keeps the visible event text, headings on their own lines", () => {
    expect(text).toContain("JONAS-STYLE SOLO\nThursday, November 12th\n5:30 p.m.");
    expect(text).toContain("The Fictional Tide Band");
    expect(text).toContain("7 p.m. - 10 p.m.");
    expect(text).toContain("Every Tuesday: open mic night.");
  });

  it("drops script, style, noscript, svg, template and comments", () => {
    for (const noise of ["NOT PAGE TEXT", "dataLayer", "background", "NOSCRIPT NOISE", "SVG NOISE", "TEMPLATE NOISE", "comment"]) {
      expect(text).not.toContain(noise);
    }
    expect(text).not.toMatch(/[<>]/);
  });

  it("decodes entities and collapses whitespace", () => {
    expect(text).toContain("Fiddle & guitar — no cover. Kids welcome & dogs on the patio.");
    expect(text).not.toMatch(/ {2}/);
  });

  it("caps at 30,000 characters", () => {
    expect(htmlToText("<p>" + "word ".repeat(20_000) + "</p>").length).toBeLessThanOrEqual(30_000);
  });
});
