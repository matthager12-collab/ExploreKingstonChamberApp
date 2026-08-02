// E17 admin import API (/api/admin/import/qwick) — the no-terminal surface.
// Auth gates (401/403), preview persistence (dry_run row, records untouched),
// apply through the real store choke points (drafts + aliases, runBy = the
// admin but updated_by = the import principal), the body/row caps, and the
// malformed-export 400. Runs on the checked-in fixtures + PGlite — no network.

import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { count } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { readRecordRows } from "@/lib/db/records";
import { importRun, listingAlias } from "@/lib/db/import-schema";
import { IMPORT_PRINCIPAL } from "@/lib/import/qwick";
import { getDirectoryListings } from "@/lib/stores/directory-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const FULL = JSON.parse(
  readFileSync("tests/fixtures/qwick/full-response.json", "utf8"),
) as unknown;
const CLEAN = JSON.parse(
  readFileSync("tests/fixtures/qwick/clean-response.json", "utf8"),
) as unknown;

// Switchable session (canonical pattern: tests/unit/moderation-gate.test.ts).
const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    role: string;
    orgId: string | null;
    editableIds: string[];
    entitlements: Record<string, unknown>;
    name: string;
    email: string;
  },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  // Mirrors the real route gate: 401 signed out, 403 signed-in wrong role.
  requireAdmin: vi.fn(async () => {
    if (!authState.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    if (authState.user.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }
    return null;
  }),
}));

import { GET, POST } from "@/app/api/admin/import/qwick/route";

const ADMIN_EMAIL = "admin@example.test";

function asAdmin() {
  authState.user = {
    id: "admin-1",
    role: "admin",
    orgId: null,
    editableIds: [],
    entitlements: {},
    name: "Admin",
    email: ADMIN_EMAIL,
  };
}
function asMember() {
  authState.user = {
    id: "member-1",
    role: "member-business",
    orgId: "org-x",
    editableIds: [],
    entitlements: {},
    name: "Member",
    email: "member@example.test",
  };
}
function signedOut() {
  authState.user = null;
}

function postReq(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/admin/import/qwick", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

/** Wraps request.text() so a test can assert whether the body was buffered. */
function watchBodyRead(req: NextRequest): { read: () => boolean } {
  let read = false;
  const original = req.text.bind(req);
  Object.defineProperty(req, "text", {
    configurable: true,
    value: async () => {
      read = true;
      return original();
    },
  });
  return { read: () => read };
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth gates", () => {
  it("unauthenticated POST and GET → 401", async () => {
    signedOut();
    expect((await POST(postReq({ mode: "preview", export: FULL }))).status).toBe(401);
    expect((await GET()).status).toBe(401);
  });

  it("signed-in non-admin POST and GET → 403", async () => {
    asMember();
    expect((await POST(postReq({ mode: "preview", export: FULL }))).status).toBe(403);
    expect((await GET()).status).toBe(403);
  });
});

describe("preview", () => {
  it("full fixture → 200 with the bucketed plan; dry_run row persisted; records untouched", async () => {
    asAdmin();
    const recordsBefore = await readRecordRows("directory");
    const res = await POST(postReq({ mode: "preview", export: FULL }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.runId).toBe("string");
    // The same manifest the pure-plan suite asserts (fixture contract).
    expect(json.stats).toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
      matched: 2,
      quarantined: 3,
      deletedUpstream: 0,
    });
    expect(json.plan.created[0].record.id).toBe("filling-station-espresso");

    // Persisted as a dry_run, attributed to the ADMIN who ran it.
    const runs = await tdb.db.select().from(importRun);
    expect(runs).toHaveLength(1);
    expect(runs[0].mode).toBe("dry_run");
    expect(runs[0].runBy).toBe(ADMIN_EMAIL);

    // A preview writes NOTHING else: no records, no aliases.
    expect(await readRecordRows("directory")).toEqual(recordsBefore);
    const [{ n: aliases }] = await tdb.db.select({ n: count() }).from(listingAlias);
    expect(Number(aliases)).toBe(0);
  });
});

describe("apply", () => {
  it("clean fixture → drafts created via the choke point; runBy admin, updated_by import principal", async () => {
    asAdmin();
    const res = await POST(postReq({ mode: "apply", export: CLEAN }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stats.created).toBe(2); // kayak rentals + filling station
    expect(json.stats.matched).toBe(1); // jaime by name → curated seed, local wins

    // Every created record is an invisible draft with provenance stamped —
    // updated_by MUST be the import principal (precedence-law discriminator),
    // never the admin who pressed the button.
    const rows = await readRecordRows("directory");
    const kayak = rows.find((r) => r.id === "kingston-kayak-rentals");
    expect(kayak?.status).toBe("draft");
    expect(kayak?.source).toBe("import");
    expect(kayak?.externalId).toBe("qw-103");
    expect(kayak?.updatedBy).toBe(IMPORT_PRINCIPAL);
    expect(rows.find((r) => r.id === "filling-station-espresso")?.status).toBe("draft");

    // Drafts stay invisible to the public getter (moderation floor).
    expect(await getDirectoryListings()).toEqual([]);

    // The local-wins match is remembered as an alias; the curated seed got no
    // overlay row.
    const aliasRows = await tdb.db.select().from(listingAlias);
    expect(aliasRows.find((a) => a.externalId === "qw-101")?.subjectId).toBe("jaime-les-crepes");
    expect((await readRecordRows("restaurants")).find((r) => r.id === "jaime-les-crepes")).toBeUndefined();

    // The run row is the admin's; the record writes stay the importer's.
    const applyRuns = (await tdb.db.select().from(importRun)).filter((r) => r.mode === "apply");
    expect(applyRuns).toHaveLength(1);
    expect(applyRuns[0].runBy).toBe(ADMIN_EMAIL);
  });
});

describe("history", () => {
  it("GET lists both runs, newest first, without the full report", async () => {
    asAdmin();
    const res = await GET();
    expect(res.status).toBe(200);
    const { runs } = await res.json();
    expect(runs).toHaveLength(2);
    expect(runs.map((r: { mode: string }) => r.mode)).toEqual(["apply", "dry_run"]);
    for (const run of runs) {
      expect(run.runBy).toBe(ADMIN_EMAIL);
      expect(run).not.toHaveProperty("report");
      expect(typeof run.stats.created).toBe("number");
    }
  });
});

describe("input guards", () => {
  it("oversized body → 413", async () => {
    asAdmin();
    const res = await POST(postReq("x".repeat(6 * 1024 * 1024 + 16)));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);
  });

  // Regression: the cap used to be applied only AFTER request.text() had
  // already buffered the whole body, so it bounded JSON.parse and nothing else.
  it("an over-cap Content-Length is refused WITHOUT buffering the body", async () => {
    asAdmin();
    const req = postReq({ mode: "preview", export: CLEAN }, {
      "content-length": String(6 * 1024 * 1024 + 1),
    });
    const watcher = watchBodyRead(req);
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);
    expect(watcher.read(), "the body was buffered despite the header cap").toBe(false);
  });

  // …but the header is a claim, not a guarantee: an honest small/absent
  // Content-Length must not widen the cap, and chunked uploads send none.
  it("a lying (small) Content-Length does not widen the cap", async () => {
    asAdmin();
    const res = await POST(
      postReq("x".repeat(6 * 1024 * 1024 + 16), { "content-length": "12" }),
    );
    expect(res.status).toBe(413);
  });

  it("a malformed Content-Length is ignored, not trusted", async () => {
    asAdmin();
    const res = await POST(
      postReq({ mode: "preview", export: CLEAN }, { "content-length": "not-a-number" }),
    );
    // Falls through to the real byte check, which this small body passes.
    expect(res.status).toBe(200);
  });

  // Regression: `.length` counts UTF-16 code units. A 3-bytes-per-char export
  // (em dashes, accented business names, CJK) can be >6 MB on the wire while
  // measuring well under 6 M code units, sailing straight past a length cap.
  it("a multi-byte body over 6 MB of BYTES → 413 even though .length is under the cap", async () => {
    asAdmin();
    // U+2014 EM DASH: 1 UTF-16 code unit, 3 UTF-8 bytes.
    const body = "—".repeat(2_200_000);
    expect(body.length).toBeLessThan(6 * 1024 * 1024);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(6 * 1024 * 1024);
    // No Content-Length header — this exercises the post-read byte check only.
    const res = await POST(postReq(body));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);
  });

  it("malformed export → 400 with the rowsFromExport message", async () => {
    asAdmin();
    const res = await POST(postReq({ mode: "preview", export: { nope: true } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unrecognized export shape/);
  });

  it("row count over the cap → 400", async () => {
    asAdmin();
    const rows = Array.from({ length: 2001 }, (_, i) => ({ id: `cap-${i}`, name: `Cap ${i}` }));
    const res = await POST(postReq({ mode: "preview", export: rows }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cap is 2000/);
  });

  it("unknown mode → 400", async () => {
    asAdmin();
    const res = await POST(postReq({ mode: "run", export: CLEAN }));
    expect(res.status).toBe(400);
  });

  it("no export + dead vendor → 502 pointing at the saved-export path", async () => {
    asAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND node.qwickmedia.com");
      }),
    );
    const res = await POST(postReq({ mode: "preview" }));
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error).toMatch(/saved export/i);
    expect(error).toMatch(/QWICK-DECOMMISSION/);
  });
});
