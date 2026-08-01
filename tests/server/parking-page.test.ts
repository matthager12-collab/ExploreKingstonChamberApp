// E31 phase 6 — /parking must ship the park & ride callout.
//
// The owner ask behind the phase is "call out and mark the specific park and
// rides": the MAP marks them (P&R badge — covered by the seed + renderer
// tests), and this suite proves the PAGE calls them out in words, with the bus
// routes and the Kitsap Transit source link a rider needs.

import { describe, expect, it } from "vitest";
import { BASE_URL } from "./config";

/** The document minus <script> blocks — what a visitor can actually read
 *  (assertions on raw Next HTML otherwise match the RSC flight payload). */
function visibleHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
}

describe("/parking park & ride callout", () => {
  it("renders the callout with both lots, their bus routes, and the source link", async () => {
    const res = await fetch(BASE_URL + "/parking");
    expect(res.status).toBe(200);
    const html = visibleHtml(await res.text());

    expect(html).toContain("Leave the car here");
    expect(html).toContain("George&#x27;s Corner Park &amp; Ride");
    expect(html).toContain("Bayside Community Church Park &amp; Ride");
    // The routes ride in the zone summaries — 307/391 and 302/391.
    expect(html).toMatch(/307/);
    expect(html).toMatch(/302/);
    expect(html).toMatch(/391/);
    expect(html).toContain("kitsaptransit.com/rider-resources/park-and-ride-lots");
  });
});
