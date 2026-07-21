// E27 — the ferry fares record: seed accuracy and the buildFares write-gate.
//
// Two different failures are guarded here.
//
// 1. SEED ACCURACY. Moving fares out of hardcoded JSX and into a record was
//    explicitly a move, not a re-pricing — the figures must still be the ones
//    /ferry rendered before. A fare quietly drifting from the real WSF price is
//    an accuracy failure a visitor pays for at the tollbooth, so the exact
//    numbers are pinned. Updating them is legitimate (WSF adjusts most
//    Octobers) — but it should be a deliberate edit that trips this test, not
//    a side effect of some other change.
//
// 2. WRITE-GATE. The POST handler rebuilds the doc from known fields so
//    arbitrary JSON never reaches the overlay. That property is only real if
//    malformed rows are actually rejected.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FERRY_FARES } from "@/lib/data/ferry-info";
import { getFerryInfo } from "@/lib/stores/ferry-info-store";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; email: string },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  requireAdmin: vi.fn(async () =>
    authState.user?.role === "admin"
      ? null
      : Response.json({ error: "Sign in first" }, { status: 401 }),
  ),
}));

import { POST } from "@/app/api/admin/ferry-info/route";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/admin/ferry-info", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

/** A minimal valid fares doc; individual tests override one piece. */
function faresDoc(over: Record<string, unknown> = {}) {
  return {
    walkOn: [{ label: "Round trip on foot", amount: "$11.35" }],
    drive: [{ label: "Car and driver, each way", amount: "$27.00" }],
    fastFerry: [{ label: "Kingston to Seattle", amount: "$2.00" }],
    ratesAsOf: "Summer 2026 rates.",
    sources: [{ label: "WSDOT fares", url: "https://www.wsdot.wa.gov/ferries/fares" }],
    ...over,
  };
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  authState.user = { id: "admin-1", role: "admin", email: "admin@example.test" };
});
afterAll(async () => {
  await tdb.close();
});

describe("ferry fares seed", () => {
  const amounts = (rows: readonly { label: string; amount: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.label, r.amount]));

  it("still carries the exact figures /ferry rendered before E27", () => {
    const walk = amounts(FERRY_FARES.walkOn);
    expect(walk["Round trip on foot"]).toBe("$11.35");
    expect(walk["Senior or rider with a disability"]).toBe("$5.65");
    expect(walk["Kids 18 and under"]).toBe("Free");

    const drive = amounts(FERRY_FARES.drive);
    expect(drive["Car and driver, each way"]).toBe("$27.00");
    expect(drive["Motorcycle"]).toBe("$11.80");
    expect(drive["Each extra passenger"]).toBe("$11.35");

    const fast = amounts(FERRY_FARES.fastFerry);
    expect(fast["Kingston to Seattle"]).toBe("$2.00");
    expect(fast["Seattle back to Kingston"]).toBe("$13.00");
  });

  it("surfaces the senior/disability discount as its own labeled row", () => {
    // The whole point of the M-01-06 remainder: this fact was buried
    // mid-sentence, where the riders it applies to did not find it.
    const senior = FERRY_FARES.walkOn.find((r) => /senior|disabilit/i.test(r.label));
    expect(senior, "no senior/disability fare row").toBeDefined();
    expect(senior!.note ?? "").toMatch(/RRFP|Regional Reduced/i);
  });

  it("carries a freshness label and a checkable source", () => {
    expect(FERRY_FARES.ratesAsOf).toMatch(/2026/);
    expect(FERRY_FARES.ratesAsOf).toMatch(/October/i);
    expect(FERRY_FARES.sources.length).toBeGreaterThan(0);
    for (const s of FERRY_FARES.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  it("is reachable through getFerryInfo(), so /ferry can render it", async () => {
    const info = await getFerryInfo();
    expect(info.fares.walkOn.length).toBeGreaterThan(0);
  });
});

describe("POST /api/admin/ferry-info { id: 'fares' }", () => {
  it("saves a clean fares doc and it reads back merged", async () => {
    const res = await post({ id: "fares", doc: faresDoc() });
    expect(res.status).toBe(200);
    const info = await getFerryInfo();
    expect(info.fares.ratesAsOf).toBe("Summer 2026 rates.");
  });

  it("keeps only known fields — arbitrary JSON never reaches the overlay", async () => {
    const res = await post({
      id: "fares",
      doc: faresDoc({ sneaky: "should not persist", walkOn: [
        { label: "Walk", amount: "$1.00", note: "ok", evil: "<script>" },
      ] }),
    });
    expect(res.status).toBe(200);
    const doc = (await res.json()).doc;
    expect(doc.sneaky).toBeUndefined();
    expect(doc.walkOn[0].evil).toBeUndefined();
    expect(doc.walkOn[0]).toEqual({ label: "Walk", amount: "$1.00", note: "ok" });
  });

  it("drops fully blank rows the editor may leave behind", async () => {
    const res = await post({
      id: "fares",
      doc: faresDoc({
        walkOn: [{ label: "Walk", amount: "$1.00" }, { label: "", amount: "", note: "" }],
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).doc.walkOn).toHaveLength(1);
  });

  it("rejects a fare row missing its amount", async () => {
    const res = await post({
      id: "fares",
      doc: faresDoc({ walkOn: [{ label: "Round trip on foot", amount: "" }] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/amount/i);
  });

  it("rejects a fare row missing its label", async () => {
    const res = await post({
      id: "fares",
      doc: faresDoc({ drive: [{ label: "", amount: "$27.00" }] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/label/i);
  });

  it("rejects a fares doc with no fare rows at all", async () => {
    const res = await post({
      id: "fares",
      doc: faresDoc({ walkOn: [], drive: [], fastFerry: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a non-admin", async () => {
    authState.user = null;
    const res = await post({ id: "fares", doc: faresDoc() });
    expect(res.status).toBe(401);
    authState.user = { id: "admin-1", role: "admin", email: "admin@example.test" };
  });
});
