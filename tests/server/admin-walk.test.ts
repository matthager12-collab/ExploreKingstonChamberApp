// Generated unauthenticated route-gating walk.
//
// There is no middleware.ts — every admin/portal endpoint gates itself by
// convention (requireAdmin() or an inline session check). Nothing catches a
// future route that forgets the gate. This test enumerates every
// src/app/api/admin/** and src/app/api/portal/** route from disk, derives its
// URL + exported methods, hits each one WITHOUT a session cookie, and asserts it
// refuses (401/403). A new route is auto-covered; a route that forgets to gate
// becomes a CI failure instead of a silent hole.

import fs from "fs";
import path from "path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { BASE_URL } from "./config";

const SRC_APP = path.join(process.cwd(), "src", "app");

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Pair {
  method: Method;
  url: string;
  file: string;
}

function urlFor(absFile: string): string {
  const rel = path.relative(SRC_APP, absFile).replace(/\\/g, "/");
  return "/" + rel.replace(/\/route\.ts$/, "");
}

function methodsFor(absFile: string): Method[] {
  const text = fs.readFileSync(absFile, "utf8");
  const found = new Set<Method>();
  const fn = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
  const cn = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = fn.exec(text))) found.add(m[1] as Method);
  while ((m = cn.exec(text))) found.add(m[1] as Method);
  return [...found];
}

function pairsUnder(glob: string): Pair[] {
  const files = fg.sync(glob, { cwd: SRC_APP, absolute: true }).sort();
  const pairs: Pair[] = [];
  for (const file of files) {
    const url = urlFor(file);
    const rel = path.relative(SRC_APP, file);
    // Dynamic segments would need a concrete param to probe — none exist today.
    expect(url, `Dynamic route segment in ${rel} — add a param resolver to the walk test`).not.toMatch(/\[/);
    const methods = methodsFor(file);
    expect(methods.length, `Route file exports zero HTTP methods: ${rel}`).toBeGreaterThan(0);
    for (const method of methods) pairs.push({ method, url, file: rel });
  }
  return pairs;
}

const adminPairs = pairsUnder("api/admin/**/route.ts");
const portalPairs = pairsUnder("api/portal/**/route.ts");

async function status(method: Method, urlPath: string): Promise<number> {
  const init: RequestInit = { method, redirect: "manual" };
  if (method !== "GET") {
    init.headers = { "content-type": "application/json" };
    init.body = "{}";
  }
  const res = await fetch(BASE_URL + urlPath, init);
  return res.status;
}

// Public-by-design overrides (documented): the two portal calendar-deconfliction
// GETs return 400 for a bare request (they need onDate or an owner id), not 401.
function expectedFor(p: Pair): number[] {
  if (p.method === "GET" && p.url === "/api/portal/events") return [400];
  if (p.method === "GET" && p.url === "/api/portal/needs") return [400];
  return [401, 403];
}

describe("route enumeration tripwires", () => {
  it("covers >= 24 admin method-route pairs", () => {
    expect(adminPairs.length).toBeGreaterThanOrEqual(24);
  });
  it("covers >= 12 portal method-route pairs", () => {
    expect(portalPairs.length).toBeGreaterThanOrEqual(12);
  });
});

describe("admin routes reject unauthenticated callers", () => {
  it.each(adminPairs.map((p) => [`${p.method} ${p.url}`, p] as const))(
    "%s -> 401/403",
    async (_label, p) => {
      const s = await status(p.method, p.url);
      expect(expectedFor(p), `${p.method} ${p.url} (${p.file}) returned ${s} — expected one of`).toContain(s);
    },
  );

  it("GET /api/admin/backup -> exactly 403 (crown jewels: bundle has password hashes; only gate is role!==admin)", async () => {
    expect(await status("GET", "/api/admin/backup")).toBe(403);
  });
});

describe("portal routes reject unauthenticated callers (with documented public branches)", () => {
  it.each(portalPairs.map((p) => [`${p.method} ${p.url}`, p] as const))(
    "%s -> gated (or 400 for the public deconfliction GETs)",
    async (_label, p) => {
      const s = await status(p.method, p.url);
      expect(expectedFor(p), `${p.method} ${p.url} (${p.file}) returned ${s} — expected one of`).toContain(s);
    },
  );

  it("GET /api/portal/events?ownerId=x -> 401 (owner lookup needs a session)", async () => {
    const res = await fetch(`${BASE_URL}/api/portal/events?ownerId=x`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });
  it("GET /api/portal/needs?charityId=x -> 401 (charity lookup needs a session)", async () => {
    const res = await fetch(`${BASE_URL}/api/portal/needs?charityId=x`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });
});

describe("hand-listed gated endpoints outside the admin/portal namespaces", () => {
  it("GET /api/hunts -> 401", async () => {
    expect(await status("GET", "/api/hunts")).toBe(401);
  });
  it("POST /api/hunts -> 401", async () => {
    expect(await status("POST", "/api/hunts")).toBe(401);
  });
  it("POST /api/hunts/reference -> 401", async () => {
    expect(await status("POST", "/api/hunts/reference")).toBe(401);
  });
  it("GET /api/hunts/photo?p=photos/x.jpg -> 401/403 (player submissions are admin-only)", async () => {
    const res = await fetch(`${BASE_URL}/api/hunts/photo?p=photos/x.jpg`, { redirect: "manual" });
    expect([401, 403]).toContain(res.status);
  });
  it("POST /api/auth/setup -> 403 (bootstrap locked once a user exists)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.z", password: "abcdefgh", name: "X" }),
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });
  it("GET /api/health -> 200 (sanity: the seeded server is up and DATA_DIR writable)", async () => {
    expect(await status("GET", "/api/health")).toBe(200);
  });
});
