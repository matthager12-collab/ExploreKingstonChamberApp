// Pins clientKey()'s trust ordering, because every public intake's IP bucket
// is only as good as this one derivation. The property under guard: no header
// the CLIENT controls may ever become the key. The edge (Cloudflare in front
// of Render, on both prod hosts) writes cf-connecting-ip / true-client-ip
// itself and APPENDS to x-forwarded-for, so the platform headers and the
// rightmost XFF hop are edge-written while the leftmost XFF hop is whatever
// the caller typed. A regression back to "first hop of XFF" would hand every
// caller an unlimited supply of fresh buckets — hence a dedicated suite for a
// six-line function.

import { describe, expect, it } from "vitest";

import { clientKey } from "@/lib/rate-limit";

/** A GET to nowhere carrying exactly `headers` — clientKey reads nothing else. */
function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

describe("clientKey", () => {
  it("prefers cf-connecting-ip over everything else", () => {
    const key = clientKey(
      req({
        "cf-connecting-ip": "203.0.113.7",
        "true-client-ip": "203.0.113.8",
        "x-forwarded-for": "6.6.6.6, 198.51.100.2",
        "x-real-ip": "203.0.113.9",
      }),
      "login",
    );
    expect(key).toBe("login:203.0.113.7");
  });

  it("falls back to true-client-ip when cf-connecting-ip is absent", () => {
    const key = clientKey(
      req({
        "true-client-ip": "203.0.113.8",
        "x-forwarded-for": "6.6.6.6, 198.51.100.2",
      }),
      "login",
    );
    expect(key).toBe("login:203.0.113.8");
  });

  it("ignores the client-suppliable leftmost x-forwarded-for hop", () => {
    // The caller sent their own XFF ("6.6.6.6") and the edge appended the
    // real connecting IP. Only the rightmost, edge-written hop may be used.
    const key = clientKey(
      req({ "x-forwarded-for": "6.6.6.6, 203.0.113.50" }),
      "claim-signup",
    );
    expect(key).toBe("claim-signup:203.0.113.50");
  });

  it("uses the rightmost hop of a multi-proxy chain", () => {
    const key = clientKey(
      req({ "x-forwarded-for": "6.6.6.6, 198.51.100.2, 10.226.90.65" }),
      "track",
    );
    expect(key).toBe("track:10.226.90.65");
  });

  it("handles a single-value x-forwarded-for (dev, tests, one proxy)", () => {
    const key = clientKey(req({ "x-forwarded-for": "203.0.113.11" }), "login");
    expect(key).toBe("login:203.0.113.11");
  });

  it("survives trailing commas and whitespace in x-forwarded-for", () => {
    // A malformed trailing comma must not yield an empty-string hop that
    // pools everyone into one bucket.
    const key = clientKey(
      req({ "x-forwarded-for": " 6.6.6.6 , 203.0.113.12 , " }),
      "login",
    );
    expect(key).toBe("login:203.0.113.12");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent or empty", () => {
    expect(clientKey(req({ "x-real-ip": "203.0.113.13" }), "login")).toBe(
      "login:203.0.113.13",
    );
    expect(
      clientKey(
        req({ "x-forwarded-for": "  ", "x-real-ip": "203.0.113.14" }),
        "login",
      ),
    ).toBe("login:203.0.113.14");
  });

  it('keys "unknown" when no IP header is present at all', () => {
    expect(clientKey(req({}), "login")).toBe("login:unknown");
  });
});
