// E12 adapters: allowlist enforcement, truth-triple rejection (the soft-404),
// the "classical" index-grep trap, pagination and per-run caps. All network
// stubbed — deps.fetchImpl is the injection seam; spacingMs: 0 keeps the
// suite fast.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchAmsIcalEvents, MAX_ICS_FETCHES_PER_RUN } from "@/lib/events/ams-ical-adapter";
import { AllowlistError, assertAllowlisted } from "@/lib/events/ingest-http";
import { fetchTribeEvents, MAX_TRIBE_PAGES } from "@/lib/events/tribe-adapter";

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf8");

function response(body: string, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

const stub = (handler: (url: string) => Response) =>
  vi.fn(async (input: RequestInfo | URL) => handler(String(input))) as unknown as typeof fetch;

describe("SOURCE_ALLOWLIST enforcement", () => {
  it("assertAllowlisted accepts exactly the three source hosts", () => {
    expect(() => assertAllowlisted("https://portofkingston.org/wp-json/x")).not.toThrow();
    expect(() => assertAllowlisted("https://business.kingstonchamber.com/events")).not.toThrow();
    expect(() => assertAllowlisted("https://explorekingstonwa.com/wp-json/x")).not.toThrow();
  });

  it("allowlist rejection: an adapter given a non-allowlisted URL throws and fetches nothing", async () => {
    const fetchImpl = stub(() => response("{}", "application/json"));
    await expect(
      fetchTribeEvents(
        { baseUrl: "https://evil.example.com", source: "tribe-portofkingston" },
        { fetchImpl, spacingMs: 0 },
      ),
    ).rejects.toThrow(AllowlistError);
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      fetchAmsIcalEvents({ baseUrl: "https://facebook.com" }, { fetchImpl, spacingMs: 0 }),
    ).rejects.toThrow(AllowlistError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchTribeEvents", () => {
  it("parses a real page and reports counts", async () => {
    const fetchImpl = stub(() => response(fixture("tribe-portofkingston-org-page1.json"), "application/json"));
    const { events, report } = await fetchTribeEvents(
      { baseUrl: "https://portofkingston.org", source: "tribe-portofkingston" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events.length).toBeGreaterThan(0);
    expect(report.parsed).toBe(events.length);
    // The real page reports 7 total_pages, so the ONE legitimate entry is the
    // once-per-run cap notice; anything else is a real failure.
    expect(report.errors.filter((e) => !e.includes("capped"))).toEqual([]);
    expect(report.errors).toHaveLength(1);
  });

  it("tolerates the healthy-but-empty feed (total: 0) with zero errors", async () => {
    const fetchImpl = stub(() =>
      response(JSON.stringify({ events: [], total: 0, total_pages: 0 }), "application/json"),
    );
    const { events, report } = await fetchTribeEvents(
      { baseUrl: "https://explorekingstonwa.com", source: "tribe-explorekingstonwa" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.fetched).toBe(1);
  });

  it("truth triple: HTTP 200 with an HTML body is a recorded failure, not data", async () => {
    const fetchImpl = stub(() => response("<html>maintenance</html>", "text/html"));
    const { events, report } = await fetchTribeEvents(
      { baseUrl: "https://portofkingston.org", source: "tribe-portofkingston" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("content-type");
  });

  it("caps pagination at MAX_TRIBE_PAGES and records the cap", async () => {
    const page = JSON.stringify({
      events: [],
      total: 350,
      total_pages: 7,
    });
    const fetchImpl = stub(() => response(page, "application/json"));
    const { report } = await fetchTribeEvents(
      { baseUrl: "https://portofkingston.org", source: "tribe-portofkingston" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(report.fetched).toBe(MAX_TRIBE_PAGES);
    expect(report.errors.some((e) => e.includes("capped"))).toBe(true);
  });

  it("network failure fails soft: error in the report, no throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const { events, report } = await fetchTribeEvents(
      { baseUrl: "https://portofkingston.org", source: "tribe-portofkingston" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events).toEqual([]);
    expect(report.errors[0]).toContain("request failed");
  });
});

describe("fetchAmsIcalEvents", () => {
  const INDEX = `<html><body>
    <h3>An Evening of Classical Music</h3>
    <a href="/events/Details/grand-hallway-art-show-1770249">Art Show</a>
    <a href="/events/Details/steel-rain-steel-drum-summer-outdoor-concert-series-1736723">Concert</a>
    <a href="/events/Details/grand-hallway-art-show-1770249">Art Show (dup link)</a>
  </body></html>`;

  it("derives .ics URLs from Details slugs only — the classical trap stays sprung", async () => {
    const urls: string[] = [];
    const fetchImpl = stub((url) => {
      urls.push(url);
      if (url.endsWith("/events")) return response(INDEX, "text/html");
      return response(fixture("ams-grand-hallway-art-show-1770249.ics"), "text/calendar");
    });
    const { events, report } = await fetchAmsIcalEvents(
      { baseUrl: "https://business.kingstonchamber.com" },
      { fetchImpl, spacingMs: 0 },
    );
    // Index + exactly the two DEDUPED slugs — nothing derived from the word
    // "Classical", nothing from grepping for "ical".
    expect(urls).toEqual([
      "https://business.kingstonchamber.com/events",
      "https://business.kingstonchamber.com/events/ICal/grand-hallway-art-show-1770249.ics",
      "https://business.kingstonchamber.com/events/ICal/steel-rain-steel-drum-summer-outdoor-concert-series-1736723.ics",
    ]);
    expect(events).toHaveLength(2);
    expect(report.parsed).toBe(2);
  });

  it("the soft-404 body (200 + text/html + 'Event is not found.') is skipped via the truth triple", async () => {
    const fetchImpl = stub((url) => {
      if (url.endsWith("/events")) return response(INDEX, "text/html");
      if (url.includes("grand-hallway")) return response(fixture("soft-404.html"), "text/html");
      return response(fixture("ams-grand-hallway-art-show-1770249.ics"), "text/calendar");
    });
    const { events, report } = await fetchAmsIcalEvents(
      { baseUrl: "https://business.kingstonchamber.com" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events).toHaveLength(1);
    expect(report.skipped).toBe(1);
    expect(report.errors.some((e) => e.includes("soft-404") || e.includes("content-type"))).toBe(true);
  });

  it("a dead subdomain fails soft with a truth-triple rejection in the report (delta 2)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const { events, report } = await fetchAmsIcalEvents(
      { baseUrl: "https://business.kingstonchamber.com" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events).toEqual([]);
    expect(report.errors[0]).toContain("request failed");
  });

  it("caps per-event fetches at the per-run maximum and records the cap", async () => {
    const manyLinks = Array.from(
      { length: 70 },
      (_, i) => `<a href="/events/Details/event-${i}-${1000 + i}">E${i}</a>`,
    ).join("\n");
    const fetchImpl = stub((url) => {
      if (url.endsWith("/events")) return response(`<html>${manyLinks}</html>`, "text/html");
      return response(fixture("ams-grand-hallway-art-show-1770249.ics"), "text/calendar");
    });
    const { report } = await fetchAmsIcalEvents(
      { baseUrl: "https://business.kingstonchamber.com" },
      { fetchImpl, spacingMs: 0 },
    );
    expect(report.fetched).toBe(1 + MAX_ICS_FETCHES_PER_RUN);
    expect(report.errors.some((e) => e.includes("capped"))).toBe(true);
  });

  it("whole-calendar feed mode (delta 2): one request, no index scrape", async () => {
    const urls: string[] = [];
    const fetchImpl = stub((url) => {
      urls.push(url);
      return response(fixture("ams-grand-hallway-art-show-1770249.ics"), "text/calendar");
    });
    const feedUrl = "https://business.kingstonchamber.com/events/Calendar/feed.ics";
    const { events, report } = await fetchAmsIcalEvents(
      { baseUrl: "https://business.kingstonchamber.com", feedUrl },
      { fetchImpl, spacingMs: 0 },
    );
    expect(urls).toEqual([feedUrl]);
    expect(events).toHaveLength(1);
    expect(report.fetched).toBe(1);
  });

  it("a broken whole-calendar feed falls back to per-event iCal in the same run", async () => {
    const fetchImpl = stub((url) => {
      if (url.includes("feed.ics")) return response("gone", "text/html");
      if (url.endsWith("/events")) return response(INDEX, "text/html");
      return response(fixture("ams-grand-hallway-art-show-1770249.ics"), "text/calendar");
    });
    const { events, report } = await fetchAmsIcalEvents(
      {
        baseUrl: "https://business.kingstonchamber.com",
        feedUrl: "https://business.kingstonchamber.com/events/Calendar/feed.ics",
      },
      { fetchImpl, spacingMs: 0 },
    );
    expect(events).toHaveLength(2);
    expect(report.errors.some((e) => e.includes("falling back"))).toBe(true);
  });
});
