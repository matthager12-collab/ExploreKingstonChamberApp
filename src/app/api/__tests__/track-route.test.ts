import { readFile } from "fs/promises";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { dataPath } from "@/lib/data-dir";
import { POST } from "@/app/api/track/route";

function post(ip: string, body: string, contentType = "text/plain") {
  return POST(
    new NextRequest("http://localhost/api/track", {
      method: "POST",
      body,
      headers: { "content-type": contentType, "x-forwarded-for": ip },
    }),
  );
}

async function readStoredLines(): Promise<Record<string, unknown>[]> {
  try {
    const raw = await readFile(dataPath("analytics", "events.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe("POST /api/track abuse controls", () => {
  it("always returns 200 {ok:true}, even when rate-limited, and caps stored rows at the limit", async () => {
    const ip = "198.51.100.5";
    for (let i = 0; i < 125; i++) {
      const res = await post(
        ip,
        JSON.stringify({ type: "pageview", path: `/p${i}`, sessionId: "sess-abc" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const lines = await readStoredLines();
    expect(lines.length).toBeLessThanOrEqual(120);
  });

  it("silently drops an oversized body without storing it", async () => {
    const oversized = JSON.stringify({
      type: "pageview",
      path: "/",
      sessionId: "sess-big",
      label: "x".repeat(9_000),
    });
    const res = await post("198.51.100.6", oversized);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const lines = await readStoredLines();
    expect(lines.some((l) => l.sessionId === "sess-big")).toBe(false);
  });

  it("never stores an ip or userAgent key, and rounds any coordinates to 3 decimals", async () => {
    await post(
      "198.51.100.7",
      JSON.stringify({
        type: "geo-ping",
        path: "/",
        sessionId: "sess-geo",
        lat: 47.79612345,
        lng: -122.49612345,
      }),
    );
    const lines = await readStoredLines();
    for (const line of lines) {
      expect(line).not.toHaveProperty("ip");
      expect(line).not.toHaveProperty("userAgent");
      if (typeof line.lat === "number") {
        expect(line.lat.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
      }
      if (typeof line.lng === "number") {
        expect(line.lng.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
      }
    }
  });
});
