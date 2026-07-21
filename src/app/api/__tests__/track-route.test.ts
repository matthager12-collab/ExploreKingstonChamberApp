// E11: the table-driven /api/track ingest suite — the PERMANENT REGRESSION
// NET for the privacy floors. Every invariant the public privacy notice
// promises about analytics is asserted here against what actually persists:
//   - geo-pings store ONLY the named-area bucket (no lat/lng keys, ever);
//   - outbound taps to food/health-assistance destinations are never stored;
//   - events on sensitive in-app paths are never stored;
//   - the persisted event shape is a CLOSED SET of fields per type (a future
//     ip/userAgent/coordinate field fails this suite);
//   - consent events carry the notice version and no location;
//   - {ok:true} always, garbage tolerated, rate limit + body cap hold.
//
// Storage assertions read back through the data layer (PGlite via
// createTestDb) — the E05 substrate that production writes to. (The pre-E11
// suite read a JSONL file the store no longer writes; its storage assertions
// were vacuous. Do not regress to file reads here.)

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/track/route";
import { readAnalyticsEvents } from "@/lib/db/append";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

// Exercise the sensitive-path drop branch through the REAL prefix helper with
// a fixture list (the live SENSITIVE_PATHS ships empty by design — the
// mechanism lands ahead of the food-assistance page that will register in it).
vi.mock("@/lib/privacy/policy", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/privacy/policy")>();
  return {
    ...mod,
    isSensitivePath: (path: string) => mod.isSensitivePath(path, ["/assist-fixture"]),
  };
});

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

function post(ip: string, body: string, contentType = "text/plain") {
  return POST(
    new NextRequest("http://localhost/api/track", {
      method: "POST",
      body,
      headers: { "content-type": contentType, "x-forwarded-for": ip },
    }),
  );
}

async function eventsFor(sessionId: string): Promise<Record<string, unknown>[]> {
  const all = await readAnalyticsEvents<Record<string, unknown>>();
  return all.filter((e) => e.sessionId === sessionId);
}

/** The closed persisted shape per event type. Adding ANY field to stored
 *  events — ip, userAgent, coordinates, whatever — must break this table. */
const ALLOWED_KEYS: Record<string, string[]> = {
  pageview: ["ts", "type", "path", "sessionId", "geo"],
  outbound: ["ts", "type", "path", "sessionId", "geo", "href", "label"],
  "geo-ping": ["ts", "type", "path", "sessionId", "geo", "area"],
  consent: ["ts", "type", "path", "sessionId", "geo", "noticeVersion", "consentPurpose"],
};

interface Case {
  name: string;
  /** Unique per case: isolates DB reads and rate-limit buckets. */
  ip: string;
  body: Record<string, unknown> | string;
  /** false = the event must NOT persist; otherwise assertions on the row. */
  persisted:
    | false
    | {
        type: keyof typeof ALLOWED_KEYS;
        expect?: Record<string, unknown>;
      };
}

const SID = (n: string) => `sess-${n}`;

const CASES: Case[] = [
  {
    name: "pageview persists with the exact closed shape",
    ip: "198.51.100.1",
    body: { type: "pageview", path: "/eat", sessionId: SID("pv") },
    persisted: { type: "pageview", expect: { path: "/eat" } },
  },
  {
    name: "outbound to a normal business link persists with href+label",
    ip: "198.51.100.2",
    body: {
      type: "outbound",
      path: "/eat",
      sessionId: SID("ob"),
      href: "https://example-restaurant.com/menu",
      label: "Menu",
    },
    persisted: {
      type: "outbound",
      expect: { href: "https://example-restaurant.com/menu", label: "Menu" },
    },
  },
  {
    name: "outbound to the food bank is NEVER persisted (acceptance criterion 3)",
    ip: "198.51.100.3",
    body: {
      type: "outbound",
      path: "/give",
      sessionId: SID("fb"),
      href: "https://sharenetfoodbank.org/whatever",
      label: "ShareNet",
    },
    persisted: false,
  },
  {
    name: "outbound to a food-bank subdomain is dropped too (suffix rule)",
    ip: "198.51.100.4",
    body: {
      type: "outbound",
      path: "/give",
      sessionId: SID("fbsub"),
      href: "https://www.sharenetfoodbank.org/hours",
      label: "ShareNet hours",
    },
    persisted: false,
  },
  {
    name: "mailto: to a food-bank address is dropped (the /give 'Raise your hand' path)",
    ip: "198.51.100.15",
    body: {
      type: "outbound",
      path: "/give",
      sessionId: SID("fbmail"),
      href: "mailto:info@sharenetfoodbank.org?subject=Volunteering%3A%20Weekend%20sort",
      label: "Raise your hand",
    },
    persisted: false,
  },
  {
    name: "trailing-dot FQDN form of the food bank is dropped (host normalization)",
    ip: "198.51.100.16",
    body: {
      type: "outbound",
      path: "/give",
      sessionId: SID("fbdot"),
      href: "https://sharenetfoodbank.org./food",
      label: "ShareNet",
    },
    persisted: false,
  },
  {
    name: "any event on a sensitive in-app path is dropped entirely",
    ip: "198.51.100.5",
    body: { type: "pageview", path: "/assist-fixture/hours", sessionId: SID("sp") },
    persisted: false,
  },
  {
    name: "in-bounds geo-ping persists ONLY the area bucket — no coordinates",
    ip: "198.51.100.6",
    body: {
      type: "geo-ping",
      sessionId: SID("geo"),
      lat: 47.79612345,
      lng: -122.49612345,
    },
    persisted: { type: "geo-ping", expect: { area: "ferry-terminal", path: "/" } },
  },
  {
    name: "out-of-bounds geo-ping is dropped (Kitsap box preserved from v1)",
    ip: "198.51.100.7",
    body: { type: "geo-ping", sessionId: SID("oob"), lat: 40.0, lng: -100.0 },
    persisted: false,
  },
  {
    name: "non-finite coordinates are dropped",
    ip: "198.51.100.8",
    body: { type: "geo-ping", sessionId: SID("nan"), lat: "nope", lng: -122.49 },
    persisted: false,
  },
  {
    name: "consent event without a path persists with path '/' and the notice version",
    ip: "198.51.100.9",
    body: { type: "consent", sessionId: SID("consent"), noticeVersion: "2026-07" },
    persisted: { type: "consent", expect: { path: "/", noticeVersion: "2026-07" } },
  },
  {
    name: "consent event never smuggles a location",
    ip: "198.51.100.10",
    body: {
      type: "consent",
      sessionId: SID("consent-loc"),
      noticeVersion: "2026-07",
      lat: 47.796,
      lng: -122.496,
    },
    persisted: { type: "consent", expect: { noticeVersion: "2026-07" } },
  },
  {
    name: "admin paths are dropped server-side (defense in depth, v1 behavior)",
    ip: "198.51.100.11",
    body: { type: "pageview", path: "/admin/worklist", sessionId: SID("adm") },
    persisted: false,
  },
  {
    name: "missing sessionId is dropped",
    ip: "198.51.100.12",
    body: { type: "pageview", path: "/no-session-marker" },
    persisted: false,
  },
  {
    name: "unknown type is dropped",
    ip: "198.51.100.13",
    body: { type: "install", path: "/", sessionId: SID("unk") },
    persisted: false,
  },
  {
    name: "garbage (non-JSON) body answers {ok:true} and stores nothing",
    ip: "198.51.100.14",
    body: "not json at all {{{",
    persisted: false,
  },
];

describe("POST /api/track — table-driven privacy-floor suite", () => {
  it.each(CASES)("$name", async (c) => {
    const raw = typeof c.body === "string" ? c.body : JSON.stringify(c.body);
    // Falsifiable drop proof: snapshot the store size before the POST — a
    // dropped event means the count is UNCHANGED (marker-matching alone can
    // be vacuous; a count delta cannot be).
    const countBefore = (await readAnalyticsEvents()).length;
    const res = await post(c.ip, raw);
    // The visitor-facing contract never varies:
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const sessionId =
      typeof c.body === "object" && typeof c.body.sessionId === "string"
        ? c.body.sessionId
        : null;

    if (c.persisted === false) {
      expect((await readAnalyticsEvents()).length).toBe(countBefore);
      if (sessionId) {
        expect(await eventsFor(sessionId)).toHaveLength(0);
      }
      return;
    }

    const rows = await eventsFor(sessionId!);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.type).toBe(c.persisted.type);

    // Closed-set shape: exactly the allowed keys, nothing else, ever.
    const allowed = ALLOWED_KEYS[c.persisted.type];
    expect([...Object.keys(row)].sort()).toEqual(
      allowed.filter((k) => k in row).sort(),
    );
    for (const key of Object.keys(row)) {
      expect(allowed, `unexpected persisted key "${key}"`).toContain(key);
    }

    // The two absolute floors, asserted by name for greppability:
    expect(row).not.toHaveProperty("lat");
    expect(row).not.toHaveProperty("lng");
    expect(row).not.toHaveProperty("ip");
    expect(row).not.toHaveProperty("userAgent");

    // The geo sub-object is a closed set too — an IP smuggled INSIDE geo
    // must fail the suite just as hard as one at the top level.
    const GEO_ALLOWED = ["country", "region", "city", "source"];
    const geo = row.geo as Record<string, unknown>;
    expect(geo).toBeDefined();
    for (const key of Object.keys(geo)) {
      expect(GEO_ALLOWED, `unexpected persisted geo key "${key}"`).toContain(key);
    }
    expect(geo).not.toHaveProperty("ip");

    for (const [k, v] of Object.entries(c.persisted.expect ?? {})) {
      expect(row[k], k).toEqual(v);
    }
  });
});

describe("POST /api/track abuse controls (preserved from v1)", () => {
  it("always 200 {ok:true} under rate limiting, and caps stored rows at the limit", async () => {
    const ip = "198.51.100.30";
    for (let i = 0; i < 125; i++) {
      const res = await post(
        ip,
        JSON.stringify({ type: "pageview", path: `/p${i}`, sessionId: SID("rate") }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const rows = await eventsFor(SID("rate"));
    expect(rows.length).toBeLessThanOrEqual(120);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("silently drops an oversized body without storing it", async () => {
    const res = await post(
      "198.51.100.31",
      JSON.stringify({
        type: "pageview",
        path: "/",
        sessionId: SID("big"),
        label: "x".repeat(9_000),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await eventsFor(SID("big"))).toHaveLength(0);
  });
});
