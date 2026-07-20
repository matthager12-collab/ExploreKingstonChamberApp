import { describe, it, expect } from "vitest";
import { freshnessStatus, probeDataDir, FRESHNESS } from "@/lib/ops-health";
import { probeDb } from "@/lib/db/ops-probe";

describe("freshnessStatus (FR-A31 quiet-by-default)", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");

  it("treats absence as UNKNOWN, never WARN", () => {
    expect(freshnessStatus(null, 1000, now)).toBe("unknown");
    expect(freshnessStatus(undefined, 1000, now)).toBe("unknown");
    expect(freshnessStatus("not-a-timestamp", 1000, now)).toBe("unknown");
  });

  it("is OK within the window and WARN past it", () => {
    const fresh = new Date(now - 500).toISOString();
    const stale = new Date(now - 2000).toISOString();
    expect(freshnessStatus(fresh, 1000, now)).toBe("ok");
    expect(freshnessStatus(stale, 1000, now)).toBe("warn");
  });

  it("treats a future timestamp (clock skew) as fresh, not alarming", () => {
    const future = new Date(now + 5000).toISOString();
    expect(freshnessStatus(future, 1000, now)).toBe("ok");
  });

  it("exposes tunable windows", () => {
    expect(FRESHNESS.backupWarnMs).toBeGreaterThan(FRESHNESS.accuracyWarnMs);
    expect(FRESHNESS.accuracyWarnMs).toBeGreaterThan(FRESHNESS.observeWarnMs);
  });
});

describe("probeDataDir", () => {
  it("reports the scratch DATA_DIR as writable", async () => {
    // unit-env.ts points DATA_DIR at a writable temp dir.
    const res = await probeDataDir();
    expect(res.ok).toBe(true);
    expect(res.detail).toBeUndefined();
  });
});

describe("probeDb degradation", () => {
  it("returns 'unknown' (never throws) when DATABASE_URL is unset", async () => {
    // unit-env.ts guarantees DATABASE_URL is unset — the fresh-clone posture the
    // ops page must render as UNKNOWN rather than crash.
    expect(await probeDb()).toBe("unknown");
  });
});
