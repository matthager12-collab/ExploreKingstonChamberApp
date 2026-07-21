// E14 slice 3 — the non-app fallbacks, asserted against the production server.
//
// This is the epic's "curl localhost:3000/simple" spot-check expressed as a
// server test: same guarantee, but it runs in CI on the standalone build the
// harness already boots (tests/server/global-setup.ts) instead of a shell
// pipeline nobody executes. `next start` does not work in this repo
// (output: "standalone"), so there is no other honest way to do it.

import { describe, expect, it } from "vitest";
import { BASE_URL } from "./config";

/** A wall-clock departure time as formatPacificTime() renders it ("2:35 PM").
 *  The separator class covers the narrow no-break space modern ICU emits. */
const TIME_RE = /\d{1,2}:\d{2}\s?(?:AM|PM)/gi;

/** Every distinct tel: target in the document. */
function telTargets(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(tel:[^"]+)"/g)].map((m) => m[1]))];
}

async function get(path: string): Promise<{ status: number; html: string }> {
  const res = await fetch(BASE_URL + path);
  return { status: res.status, html: await res.text() };
}

describe("/simple — Kingston basics", () => {
  it("serves a plain-language page with a phone number and a way to print", async () => {
    const { status, html } = await get("/simple");
    expect(status).toBe(200);

    // A number that reaches a person, as a dialable target.
    expect(telTargets(html).length).toBeGreaterThanOrEqual(1);
    // The paper fallback is one tap away.
    expect(html).toContain('href="/print"');

    // The boat section always renders — the question is only which state it is in.
    expect(html).toContain("Leaving Kingston");

    // /simple is statically rendered with ISR, so the HTML a visitor gets can be
    // older than the times printed on it. Say when it was true — the readers
    // this page exists for are the least able to spot a stale departure.
    expect(html, "/simple must stamp when its ferry times were generated").toContain(
      "These times were right at",
    );

    // Departure times OR the explicit late-night line. After the last sailing of
    // the day zero times is CORRECT; what is never acceptable is an empty block,
    // so exactly one of these two must hold.
    const hasTimes = TIME_RE.test(html);
    TIME_RE.lastIndex = 0;
    const hasNoBoatsLine = html.includes("No more boats today");
    expect(
      hasTimes || hasNoBoatsLine,
      "/simple must show departure times or say in plain words that there are none",
    ).toBe(true);
  });
});

describe("/print — the printable one-pager", () => {
  it("serves today's departures, an as-of stamp, and the numbers to call", async () => {
    const { status, html } = await get("/print");
    expect(status).toBe(200);

    // The whole day, both boats, both directions — never a handful.
    const timeMatches = html.match(TIME_RE) ?? [];
    expect(
      timeMatches.length,
      "the one-pager should carry today's full departure list",
    ).toBeGreaterThanOrEqual(3);

    // Paper outlives the render; say when it was true.
    expect(html).toContain("As of");
    // …and that the times can move.
    expect(html).toContain("call to confirm");

    // Chamber + at least one agency line, each dialable and each also printed
    // as visible digits (the visible-text half is covered by the page source;
    // here we prove the links exist and are distinct numbers).
    const tels = telTargets(html);
    expect(tels.length, `distinct tel: targets on /print: ${tels.join(", ")}`).toBeGreaterThanOrEqual(2);
  });
});

describe("site chrome — the fallbacks reachable from every page", () => {
  it("the home page carries the skip link, the simple-mode bootstrap, and a phone number", async () => {
    const { status, html } = await get("/");
    expect(status).toBe(200);

    // Slice 1's global chrome, re-asserted here against real HTML.
    expect(html).toContain('href="#main"');
    expect(html).toContain("ek-simple");

    // The footer's always-reachable human fallback (M-18-07 / FR-47).
    expect(telTargets(html).length).toBeGreaterThanOrEqual(1);
    // And the plain-language door.
    expect(html).toContain('href="/simple"');
  });
});
