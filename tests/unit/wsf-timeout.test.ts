// wsfFetch timeout floor: one hung WSDOT response must never hold the dynamic
// /ferry render hostage (undici's default keeps the socket open ~5 minutes).
// wsfFetch passes AbortSignal.timeout(...) to fetch, and the timeout rejection
// must be swallowed into the same `null` every caller already handles as the
// documented no-key/unreachable path (bundled seasonal schedule, live:false).
//
// AbortSignal.timeout runs on native timers vitest's fake timers don't reach,
// so the timer itself isn't simulated here. What IS asserted: (1) the signal
// actually reaches fetch, (2) the exact rejection undici produces on timeout
// (DOMException "TimeoutError") falls back like any other network failure,
// and (3) the keyless guard still short-circuits before fetch.
//
// wsf.ts captures WSDOT_API_KEY at module load, so each test stubs the env
// and re-imports the module fresh.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importWsf() {
  vi.resetModules();
  return import("@/lib/wsf");
}

beforeEach(() => {
  vi.stubEnv("WSDOT_API_KEY", "vitest-wsf-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("wsfFetch timeout", () => {
  it("passes an abort signal to fetch", async () => {
    const seenInits: (RequestInit | undefined)[] = [];
    vi.stubGlobal("fetch", async (_input: string, init?: RequestInit) => {
      seenInits.push(init);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { getRouteAlerts } = await importWsf();
    await expect(getRouteAlerts()).resolves.toEqual([]);
    expect(seenInits).toHaveLength(1);
    expect(seenInits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to null-path behavior when the fetch times out", async () => {
    // Exactly what undici rejects with when AbortSignal.timeout fires.
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    const wsf = await importWsf();

    // Vessel map: empty + live:false — the map then points at WSDOT VesselWatch.
    await expect(wsf.getVesselLocations()).resolves.toEqual({ vessels: [], live: false });

    // Today's sailings: the bundled seasonal schedule, marked live:false.
    const sailings = await wsf.getTodaysSailings();
    expect(sailings.live).toBe(false);
    expect(sailings.sailings.length).toBeGreaterThan(0);

    // Alerts: quietly none.
    await expect(wsf.getRouteAlerts()).resolves.toEqual([]);
  });

  it("still short-circuits before fetch when no API key is set", async () => {
    vi.stubEnv("WSDOT_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { getVesselLocations } = await importWsf();
    await expect(getVesselLocations()).resolves.toEqual({ vessels: [], live: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
