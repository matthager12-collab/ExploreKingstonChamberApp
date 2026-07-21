// The request-boundary proxy (src/proxy.ts) vs the E08 sweep machine token.
// The proxy 401s cookie-less requests to /api/admin/** — which is exactly
// right for humans, and exactly wrong for the sweep cron's Bearer request
// (found in production: the token never reached the route's own check).
// Contract pinned here: the ONE carve-out is path-exact, fail-closed on a
// missing env var, and accepts both the header and ?token= forms.

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const SWEEP_URL = "http://localhost/api/admin/worklist/sweep";

function req(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { method: "POST", headers });
}

/** NextResponse.next() marks pass-through with this header. */
function passed(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

afterEach(() => {
  delete process.env.WORKLIST_SWEEP_TOKEN;
  delete process.env.BACKUP_TOKEN;
  delete process.env.RETENTION_TOKEN;
});

describe("proxy sweep-token carve-out", () => {
  it("no cookie, no token → 401 JSON at the boundary", async () => {
    const res = proxy(req(SWEEP_URL));
    expect(res.status).toBe(401);
    expect(passed(res)).toBe(false);
  });

  it("fail-closed: right header but env var unset → 401", () => {
    const res = proxy(req(SWEEP_URL, { authorization: "Bearer sweep-secret" }));
    expect(res.status).toBe(401);
  });

  it("wrong token → 401; right token passes via header AND ?token= form", () => {
    process.env.WORKLIST_SWEEP_TOKEN = "sweep-secret";
    expect(proxy(req(SWEEP_URL, { authorization: "Bearer nope" })).status).toBe(401);
    expect(passed(proxy(req(SWEEP_URL, { authorization: "Bearer sweep-secret" })))).toBe(true);
    expect(passed(proxy(req(`${SWEEP_URL}?token=sweep-secret`)))).toBe(true);
  });

  it("the carve-out is path-exact: the token opens NO other admin route", () => {
    process.env.WORKLIST_SWEEP_TOKEN = "sweep-secret";
    for (const path of [
      "http://localhost/api/admin/worklist",
      "http://localhost/api/admin/backup",
      "http://localhost/api/admin/worklist/sweep/extra",
    ]) {
      const res = proxy(req(path, { authorization: "Bearer sweep-secret" }));
      expect(res.status, path).toBe(401);
    }
  });

  it("/api/admin/backup: the E03 BACKUP_TOKEN path works through the boundary (nightly-backup regression)", () => {
    const url = "http://localhost/api/admin/backup";
    // Fail-closed with env unset, wrong token 401s…
    expect(proxy(req(url, { authorization: "Bearer backup-secret" })).status).toBe(401);
    process.env.BACKUP_TOKEN = "backup-secret";
    expect(proxy(req(url, { authorization: "Bearer nope" })).status).toBe(401);
    // …right token passes, and each token opens ONLY its own route.
    expect(passed(proxy(req(url, { authorization: "Bearer backup-secret" })))).toBe(true);
    expect(
      proxy(req("http://localhost/api/admin/worklist/sweep", { authorization: "Bearer backup-secret" }))
        .status,
    ).toBe(401);
  });

  it("/api/admin/privacy/retention: the E11 RETENTION_TOKEN carve-out (dark-cron reachability)", () => {
    const url = "http://localhost/api/admin/privacy/retention";
    // Fail-closed with env unset; wrong token 401s.
    expect(proxy(req(url, { authorization: "Bearer retention-secret" })).status).toBe(401);
    process.env.RETENTION_TOKEN = "retention-secret";
    expect(proxy(req(url, { authorization: "Bearer nope" })).status).toBe(401);
    // Right token passes via header AND ?token= form…
    expect(passed(proxy(req(url, { authorization: "Bearer retention-secret" })))).toBe(true);
    expect(passed(proxy(req(`${url}?token=retention-secret`)))).toBe(true);
    // …and opens ONLY its own route, path-exact.
    for (const other of [
      "http://localhost/api/admin/backup",
      "http://localhost/api/admin/privacy/retention/extra",
      "http://localhost/api/admin/privacy",
    ]) {
      expect(proxy(req(other, { authorization: "Bearer retention-secret" })).status, other).toBe(401);
    }
  });
});
