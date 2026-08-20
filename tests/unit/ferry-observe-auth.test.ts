// The FERRY_OBSERVE_TOKEN gate shared by /api/ferry/observe and
// /api/ferry/accuracy (src/lib/ferry-observe-auth.ts).
//
// The only real callers are the two Render crons, which send
// `Authorization: Bearer $FERRY_OBSERVE_TOKEN` and POST — so the contract
// pinned here is exactly what keeps them working: header-only transport, a
// 401 on mismatch, fail-CLOSED (503) when the token is unset outside
// development, and no GET handler at all (observe writes to the observation
// log on every hit, so it must not be reachable by a bare link or prefetch).

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkFerryObserveAuth } from "@/lib/ferry-observe-auth";
import * as observeRoute from "@/app/api/ferry/observe/route";
import * as accuracyRoute from "@/app/api/ferry/accuracy/route";

function req(headers?: Record<string, string>, url = "http://localhost/api/ferry/observe") {
  return new NextRequest(url, { method: "POST", headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkFerryObserveAuth", () => {
  it("fails closed: token unset (outside development) → 503", async () => {
    const res = checkFerryObserveAuth(req({ authorization: "Bearer anything" }));
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: "FERRY_OBSERVE_TOKEN is not configured" });
  });

  it("token unset in development → open (npm run dev needs no secrets)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(checkFerryObserveAuth(req())).toBeNull();
  });

  it("wrong or missing Bearer → 401; the right one proceeds", () => {
    vi.stubEnv("FERRY_OBSERVE_TOKEN", "ferry-secret");
    expect(checkFerryObserveAuth(req())?.status).toBe(401);
    expect(checkFerryObserveAuth(req({ authorization: "Bearer nope" }))?.status).toBe(401);
    expect(checkFerryObserveAuth(req({ authorization: "Bearer ferry-secret" }))).toBeNull();
    // The cron's curl sends the canonical capitalisation, but the scheme
    // match is case-insensitive per the header grammar.
    expect(checkFerryObserveAuth(req({ authorization: "bearer ferry-secret" }))).toBeNull();
  });

  it("the token rides the header only — a query string is not a transport", () => {
    vi.stubEnv("FERRY_OBSERVE_TOKEN", "ferry-secret");
    const res = checkFerryObserveAuth(
      req(undefined, "http://localhost/api/ferry/observe?token=ferry-secret"),
    );
    expect(res?.status).toBe(401);
  });
});

describe("route shape", () => {
  it("both routes are POST-only (observe mutates state; both crons POST)", () => {
    for (const mod of [observeRoute, accuracyRoute] as Record<string, unknown>[]) {
      expect(typeof mod.POST).toBe("function");
      expect(mod.GET).toBeUndefined();
    }
  });
});
