// Zeffy webhook receiver: signature on the raw bytes, replay window, body
// cap, fail-closed when unconfigured, campaign filter, and a valid delivery
// scheduling exactly one resync after the response.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signZeffyPayload } from "@/lib/race/webhook-signature";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  // Outside a request scope `after` throws; run the callback inline instead.
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

const runRaceSync = vi.fn(async (_trigger: "manual" | "webhook") => ({
  ok: true as const,
  stats: {},
  runId: "run",
}));
vi.mock("@/lib/race/sync", () => ({
  runRaceSync: (trigger: "manual" | "webhook") => runRaceSync(trigger),
}));

import { POST } from "@/app/api/webhooks/zeffy/route";

const SECRET = "whsec_test_secret";
const CAMPAIGN = "camp-race";
const NOW = new Date("2026-09-16T20:00:00Z");

function event(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_1",
    type: "payment.completed",
    version: 1,
    dispatchedAt: NOW.toISOString(),
    data: { id: "pay_1", object: "payment", campaign_id: CAMPAIGN, status: "succeeded" },
    ...overrides,
  });
}

function deliver(raw: string, headers: Record<string, string> = {}, ip = "203.0.113.5") {
  return POST(
    new NextRequest("http://localhost/api/webhooks/zeffy", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(raw)),
        "x-forwarded-for": ip,
        ...headers,
      },
    }),
  );
}

const signed = (raw: string, t = Math.floor(NOW.getTime() / 1000)) => ({
  "zeffy-signature": signZeffyPayload(raw, SECRET, t),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.ZEFFY_WEBHOOK_SECRET = SECRET;
  process.env.ZEFFY_CAMPAIGN_ID = CAMPAIGN;
  runRaceSync.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/webhooks/zeffy", () => {
  it("a correctly signed payment event is acknowledged and schedules one resync", async () => {
    const raw = event();
    const res = await deliver(raw, signed(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(runRaceSync).toHaveBeenCalledTimes(1);
    expect(runRaceSync).toHaveBeenCalledWith("webhook");
  });

  it("rejects a missing, malformed, wrong-secret or tampered signature", async () => {
    const raw = event();
    expect((await deliver(raw)).status).toBe(400);
    expect((await deliver(raw, { "zeffy-signature": "t=abc,v1=zz" })).status).toBe(400);
    expect((await deliver(raw, { "zeffy-signature": signZeffyPayload(raw, "other", 1789596000) })).status).toBe(400);
    const tampered = raw.replace("succeeded", "refunded");
    expect((await deliver(tampered, signed(raw))).status).toBe(400);
    expect(runRaceSync).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay) even with a valid HMAC", async () => {
    const raw = event();
    const stale = Math.floor(NOW.getTime() / 1000) - 6 * 60;
    expect((await deliver(raw, signed(raw, stale))).status).toBe(400);
    const future = Math.floor(NOW.getTime() / 1000) + 6 * 60;
    expect((await deliver(raw, signed(raw, future))).status).toBe(400);
    expect(runRaceSync).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is not configured", async () => {
    delete process.env.ZEFFY_WEBHOOK_SECRET;
    const raw = event();
    expect((await deliver(raw, signed(raw))).status).toBe(503);
    expect(runRaceSync).not.toHaveBeenCalled();
  });

  it("acknowledges but ignores other campaigns, contact events and unparseable bodies", async () => {
    const other = event({ data: { id: "pay_2", campaign_id: "camp-donations" } });
    const res = await deliver(other, signed(other));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });

    const contact = event({ type: "contact.updated", data: { id: "c_1", object: "contact" } });
    expect(await (await deliver(contact, signed(contact))).json()).toEqual({ ignored: true });

    const junk = "{not json";
    expect((await deliver(junk, signed(junk))).status).toBe(400);
    expect(runRaceSync).not.toHaveBeenCalled();

    // Id-only updates carry no campaign: they resync (cheap, idempotent).
    const idOnly = event({ type: "payment.updated", data: { id: "pay_1", object: "payment" } });
    expect((await deliver(idOnly, signed(idOnly))).status).toBe(200);
    expect(runRaceSync).toHaveBeenCalledTimes(1);
  });

  it("refuses an oversized body before verifying anything", async () => {
    const raw = event({ padding: "x".repeat(300 * 1024) });
    expect((await deliver(raw, signed(raw))).status).toBe(413);
    expect(runRaceSync).not.toHaveBeenCalled();
  });
});
