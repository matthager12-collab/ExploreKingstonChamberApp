// E14 slice 4 — the ship-dark guarantee for /es, and the accessibility statement.
//
// These are the epic's "curl localhost:3000/es" spot-checks expressed as server
// tests: same guarantee, but run in CI against the standalone production build
// the harness already boots (tests/server/global-setup.ts). `next start` does
// not work in this repo (output: "standalone"), so there is no other honest way.
//
// The /es assertions are the ONLY end-to-end proof that DEFAULT_HIDDEN_PAGES
// works: an unreviewed Spanish safety page must 404 for the public, be
// previewable by an admin, and go live only when an operator writes an explicit
// site-pages record. Every one of those three states is exercised below.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FERRY_FARES,
  WALK_ON_ROUND_TRIP_KEY,
  walkOnRoundTripFare,
  type FerryFares,
} from "../../src/lib/data/ferry-info";
import {
  SAFETY_CONTENT,
  SAFETY_SECTION_ORDER,
  SAFETY_TOKEN_FALLBACKS,
} from "../../src/lib/i18n/safety-content";
import { BASE_URL } from "./config";
import { ADMIN_COOKIE_HEADER } from "./admin-session";

/** The walk-on round-trip figure as shipped in code, read the same way the
 *  pages read it — so this never drifts from what the seed actually says. */
function seedWalkOnFare(): string {
  const fare = walkOnRoundTripFare(FERRY_FARES as unknown as FerryFares);
  if (!fare) throw new Error("the seed has no usable walk-on round-trip fare");
  return fare;
}

/** Seeded by tests/server/global-setup.ts. */

/** Every distinct tel: target in the document. */
function telTargets(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(tel:[^"]+)"/g)].map((m) => m[1]))];
}

/** React escapes these five in text nodes; the dictionary's prose contains
 *  apostrophes and quotes, so compare against the escaped form. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * The document with every <script> block removed — i.e. what a visitor can
 * actually read.
 *
 * WHY THIS EXISTS. safety-essentials.tsx renders each step as
 * `<li key={step}>{fillSafetyText(step, values)}</li>`. The key is the RAW
 * dictionary string, and React serializes element keys into the RSC flight
 * payload that Next.js inlines in the HTML:
 *
 *   ["$","li","Greater Kingston Chamber of Commerce: {phone}. A person…",{…}]
 *
 * So `html.includes(rawStep)` is true for every step whether or not the step
 * ever rendered, and true whether or not its {tokens} were ever substituted.
 * Asserting against the payload is asserting that the dictionary exists, which
 * TypeScript already guarantees. Everything below reads the visible half only.
 */
function visibleHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
}

/** The literal text around a step's `{tokens}`, longest first. Each piece must
 *  appear in the rendered page; the token slots are filled with live values the
 *  test has no business pinning (the Chamber edits both without a deploy). */
function proseSegments(step: string): string[] {
  return step
    .split(/\{\w+\}/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

/** Assert one dictionary step actually rendered, tokens filled. */
function expectStepRendered(visible: string, step: string, where: string): void {
  const segments = proseSegments(step);
  expect(segments.length, `${where}: step has no assertable prose: ${step}`).toBeGreaterThan(0);
  for (const segment of segments) {
    expect(visible, `${where}: missing rendered text "${segment}"`).toContain(escapeHtml(segment));
  }
}

async function get(path: string, cookie?: string): Promise<{ status: number; html: string }> {
  const res = await fetch(BASE_URL + path, {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

/** Sign in as the seeded admin and return the Cookie header value to replay.
 *  Done by hand rather than with a cookie jar because the session cookie is
 *  `Secure` under NODE_ENV=production and the harness serves plain http. */
async function adminCookie(): Promise<string> {
  // Minted, not logged in — see tests/server/admin-session.ts (shared
  // login rate-limit budget). Still async so callers are unchanged.
  return ADMIN_COOKIE_HEADER;
}

/** Flip /es visibility through the real admin API — the same call the Admin →
 *  Site content toggle makes, so the test exercises the operator's actual path
 *  rather than a hand-written database row. */
async function setEsHidden(cookie: string, hidden: boolean): Promise<void> {
  const res = await fetch(BASE_URL + "/api/admin/site", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "page", path: "/es", hidden }),
  });
  expect(res.ok, `setting /es hidden=${hidden} failed with ${res.status}`).toBe(true);
}

/** Poll until `predicate` holds. /simple is a statically rendered ISR page, so
 *  after the record flip it legitimately serves its cached HTML until the
 *  revalidation window passes — that is production behavior (docs/OPERATIONS.md
 *  §10, "Edits not showing up on public pages"), not a bug to assert away. */
async function poll(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

describe("/es — the Spanish essentials page ships dark", () => {
  let cookie = "";

  beforeAll(async () => {
    cookie = await adminCookie();
  });

  afterAll(async () => {
    // Restore the fixture: back to hidden. The effective state is what matters
    // (DEFAULT_HIDDEN_PAGES makes "no record" and "hidden: true" identical for
    // a visitor), and the test database is truncated at the start of every run
    // by global-setup, so no row outlives this file in any meaningful way.
    if (cookie) await setEsHidden(cookie, true);
  });

  it("404s for an anonymous visitor while no site-pages record exists", async () => {
    const { status } = await get("/es");
    expect(
      status,
      "unreviewed hand-authored Spanish safety copy must not be publicly reachable",
    ).toBe(404);
  });

  it("renders for an admin, in Spanish, with the hidden-page banner", async () => {
    const { status, html } = await get("/es", cookie);
    expect(status).toBe(200);
    // WCAG 3.1.2 — the Spanish sits inside a lang="es" wrapper, and the one
    // English label on the page carries its own lang="en".
    expect(html).toContain('lang="es"');
    expect(html).toContain('lang="en"');
    // Content actually rendered, not just a shell.
    expect(html).toContain("Kingston en espa");
    expect(html).toContain("Hidden page");
    // The cross-link back to the English page.
    expect(html).toContain('href="/simple"');
    // The one dialable number the page promises.
    expect(telTargets(html).length).toBeGreaterThanOrEqual(1);
  });

  it("renders every Spanish safety section from the dictionary", async () => {
    const visible = visibleHtml((await get("/es", cookie)).html);
    for (const key of SAFETY_SECTION_ORDER) {
      const title = SAFETY_CONTENT.es[key].title;
      expect(visible, `missing Spanish safety section "${title}"`).toContain(title);
      // …and its instructions, not just its heading — the VISIBLE ones, with
      // {tokens} filled, not the raw dictionary string echoed in the RSC key.
      for (const step of SAFETY_CONTENT.es[key].steps) {
        expectStepRendered(visible, step, `es "${title}"`);
      }
    }
  });

  it(
    "goes public on an explicit hidden:false record, and /simple then links to it",
    async () => {
      await setEsHidden(cookie, false);

      // /es is server-rendered on demand, so this flips immediately.
      await poll("/es to answer 200 anonymously", async () => (await get("/es")).status === 200);

      // /simple is static+ISR, so it catches up within its revalidation window.
      await poll("/simple to link to /es", async () => {
        const { html } = await get("/simple");
        return html.includes('href="/es"');
      });
    },
    150_000,
  );
});

describe("the safety slice ships in English too", () => {
  it("/simple renders every English safety section from the same dictionary", async () => {
    const { status, html } = await get("/simple");
    expect(status).toBe(200);
    const visible = visibleHtml(html);
    for (const key of SAFETY_SECTION_ORDER) {
      const title = SAFETY_CONTENT.en[key].title;
      expect(visible, `missing English safety section "${title}"`).toContain(title);
      for (const step of SAFETY_CONTENT.en[key].steps) {
        expectStepRendered(visible, step, `en "${title}"`);
      }
    }
  });

  it("shows a visitor no unfilled {token}", async () => {
    // The failure this catches is literal braces on the page: a render site
    // that forgot a value, or a translator who invented a token. Nothing in
    // the visible half of /simple should look like {this}. (/es gets the same
    // assertion in the fares describe below, where a cookie is already in hand.)
    const visible = visibleHtml((await get("/simple")).html);
    const leaked = [...visible.matchAll(/\{\w+\}/g)].map((m) => m[0]);
    expect(leaked, "unsubstituted placeholder(s) rendered on /simple").toEqual([]);
  });

  it("never promises a last boat — the one thing the return-trip guidance must not do", async () => {
    const { html } = await get("/simple");
    // The section exists…
    expect(html).toContain(SAFETY_CONTENT.en.returnTrip.title);
    // …and tells the reader to confirm with WSF rather than naming a final departure.
    expect(html.toLowerCase()).toContain("confirm the last trip of the day");
    expect(html.toLowerCase()).not.toContain("the last boat is");
    expect(html.toLowerCase()).not.toContain("last boat leaves");
  });
});

describe("/accessibility — the accessibility statement", () => {
  it("states the standard, names both contact channels, and asserts no unverified date", async () => {
    const { status, html } = await get("/accessibility");
    expect(status).toBe(200);

    expect(html).toContain("WCAG 2.1");
    expect(html).toContain("Title II");

    // Feedback channel: an address AND a number, per M-14-01 / FR-47.
    expect(html).toMatch(/href="mailto:[^"]+"/);
    expect(telTargets(html).length).toBeGreaterThanOrEqual(1);

    // …and it says when it was last looked at.
    expect(html).toContain("Last reviewed");

    // The human gate (docs/OPERATIONS.md §9 item 15) was CLOSED on 2026-07-21:
    // the date was verified against ada.gov's compliance table, so this guard is
    // now the inverse — the page must SERVE the verified date end to end, not
    // merely contain it in source.
    expect(
      html.includes("April 26, 2028"),
      "the accessibility page must serve the verified ADA compliance date (OPERATIONS §9 item 15, closed)",
    ).toBe(true);
  });

  it("is linked from the footer on the home page", async () => {
    const { status, html } = await get("/");
    expect(status).toBe(200);
    expect(html).toContain('href="/accessibility"');
  });
});

// E14 × E27 — the October chore, proven end to end.
//
// tests/unit/fare-single-source.test.ts proves no page carries its own copy of
// the walk-on fare. That is a statement about the SOURCE. This is the statement
// about the RUNNING SITE, and it is the one the Chamber actually cares about:
// an admin edits the fare at /admin/ferry-info → Fares, and the plain-language
// pages say the new number without anyone touching code. Before this epic they
// did not, and docs/OPERATIONS.md §6 carried the caveat every October.
describe("the walk-on fare on /es follows the fares record, not the code", () => {
  let cookie = "";
  const EDITED = "$12.05";

  /** The seed doc with the keyed walk-on row's amount replaced. */
  function faresDocWith(amount: string): Record<string, unknown> {
    const seed = FERRY_FARES as unknown as FerryFares;
    return {
      ...seed,
      walkOn: seed.walkOn.map((r) =>
        r.key === WALK_ON_ROUND_TRIP_KEY ? { ...r, amount } : { ...r },
      ),
    };
  }

  async function saveFares(amount: string): Promise<void> {
    const res = await fetch(BASE_URL + "/api/admin/ferry-info", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: "fares", doc: faresDocWith(amount) }),
    });
    expect(res.ok, `saving fares failed with ${res.status}`).toBe(true);
  }

  beforeAll(async () => {
    cookie = await adminCookie();
  });

  afterAll(async () => {
    // Server test files share one server and one database (fileParallelism:
    // false), so put the seed figure back rather than leaving an edited fare
    // for whatever runs next.
    if (cookie) await saveFares(seedWalkOnFare());
  });

  it("shows the seed figure before anyone edits it", async () => {
    const visible = visibleHtml((await get("/es", cookie)).html);
    expect(visible, "the Spanish page should quote the seeded walk-on fare").toContain(
      seedWalkOnFare(),
    );
  });

  it("shows the edited figure after an admin saves a new fare — no deploy", async () => {
    await saveFares(EDITED);

    // /es renders on demand, so the edit is visible on the next request.
    const visible = visibleHtml((await get("/es", cookie)).html);
    expect(visible, "the Spanish page must quote the edited fare").toContain(EDITED);
    expect(
      visible,
      "the OLD figure is still on the page — something is still hardcoding it",
    ).not.toContain(seedWalkOnFare());

    // And the Spanish sentence around it is still the translator's, not an
    // English one substituted wholesale — the token fills a FIGURE only.
    expect(visible).toContain("El viaje de ida y vuelta a pie cuesta");
    expect(visible).toContain("y se paga una sola vez");
  });

  it("names no figure at all when the record has no usable one", async () => {
    // "Free" is a legitimate thing for the Chamber to type in the fare table,
    // and nonsense inside "…cuesta ___, y se paga una sola vez." The page must
    // fall back to wording, never to a number nobody entered.
    await saveFares("Free");

    const visible = visibleHtml((await get("/es", cookie)).html);
    expect(visible).toContain(SAFETY_TOKEN_FALLBACKS.es.walkOnRoundTrip);
    expect(visible, "a stale figure resurfaced when the live one was unusable").not.toContain(
      seedWalkOnFare(),
    );
    expect([...visible.matchAll(/\{\w+\}/g)].map((m) => m[0])).toEqual([]);
  });
});
