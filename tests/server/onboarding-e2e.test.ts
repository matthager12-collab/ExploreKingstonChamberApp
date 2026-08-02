// The whole business-onboarding path, walked once, end to end, through the
// REAL routes and the REAL UI against the standalone build the container
// ships. This replaces the one-off manual staging rehearsal the launch plan
// called for: a rehearsal that only happens once tells you nothing the week
// after, and every piece of this flow spans four subsystems (public intake →
// invites → auth/orgs → ownership → moderation → the public page), so unit
// tests of each half can all pass while the seam between them is broken.
//
// What it proves, in order:
//   1. a public claim REQUEST opens a queue item and grants nothing;
//   2. the Chamber mints a bound invite from /admin/claims and gets a link;
//   3. a stranger's browser redeems that link and lands in the portal;
//   4. redemption moved BOTH halves of the claim (owner stamp + edit grant),
//      and a second mint over the same listing is refused;
//   5. the member's edit HOLDS — the public page keeps serving the old copy;
//   6. an admin approves it and the public page follows;
//   7. releasing the claim unclaims the listing, revokes the owner's access,
//      and lets a fresh invite be minted — the round trip the mint-refusal
//      message promises.
//
// HOUSE RULES OBSERVED HERE
//  - Auth is the SHARED minted cookie (./admin-session), never a POST to
//    /api/auth/login: that route is rate-limited 8/60s per IP AND per account
//    and every server suite draws on the same bucket. The OWNER account is
//    created by really redeeming an invite in the browser, which is the thing
//    under test and costs no login budget.
//  - Ordered `it`s sharing module state, matching admin-media-library.test.ts.
//    A failure names its step, so a red run says which seam broke.
//  - The walk resolves the claim_request it opens (the console's own last
//    instruction to the operator) so it does not leave an open item in the
//    queue the other server suites render.
//  - IT IS SLOW ON PURPOSE (~2 min). /eat is ISR with a 60s window and
//    nothing revalidates it on write, so steps 5 and 6 wait that window out
//    against the real public URL rather than asserting through a back door.
//    See waitForEatToServe and step 5's baseline comment — the alternative is
//    an assertion that passes or fails on cache timing, which is worse than
//    no assertion at all.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { restaurants } from "@/lib/data/restaurants";
import { BASE_URL } from "./config";
import { signInAdmin } from "./admin-session";

/** A real seed restaurant (src/lib/data/restaurants.ts), read from the seed
 *  rather than retyped — a seed edit must not silently make this walk vacuous. */
const LISTING = restaurants.find((r) => r.id === "cellar-cat")!;

/** A plain-ASCII slice of the seed description. React HTML-escapes &, <, >, "
 *  and ', so asserting the whole string against served HTML could fail for
 *  encoding reasons rather than product ones; this slice contains none of
 *  them. The guard test below pins it to the seed. */
const OLD_SNIPPET = "piano and live jazz on the weekend";

/** Unique per run: the account, the org, and the copy this walk asserts on
 *  must never collide with a previous run's leftovers (or with a rerun after
 *  a crash) — and nothing here reads the wall clock. */
const RUN = Math.random().toString(36).slice(2, 8);
const OWNER_NAME = `Dana Ferry ${RUN}`;
const OWNER_EMAIL = `owner-${RUN}@example.test`;
const OWNER_PASSWORD = `onboarding-walk-${RUN}`;
/** Deliberately ASCII-only, for the same escaping reason as OLD_SNIPPET. */
const NEW_DESCRIPTION =
  `Owner-written copy from the onboarding walk ${RUN}. ` +
  `Live jazz Thursday through Sunday, and the piano stays.`;

let browser: Browser;
/** The Chamber staffer. */
let adminContext: BrowserContext;
let adminPage: Page;
/** The business owner — a FRESH context, so it carries no admin cookie. */
let ownerContext: BrowserContext;
let ownerPage: Page;

/** Carried between steps. */
let joinLink = "";
let inviteCode = "";

/* -------------------------------- helpers -------------------------------- */

/** Fetch a public page as a plain HTTP client. What matters for the public
 *  assertions is the bytes a visitor is served, not what a JS runtime could
 *  reconstruct afterwards. */
async function getPublicHtml(path: string): Promise<string> {
  const res = await fetch(BASE_URL + path);
  expect(res.status, `${path} must be publicly served`).toBe(200);
  return res.text();
}

/**
 * Poll /eat until it serves `text`.
 *
 * WHY POLLING AND NOT A SINGLE FETCH. /eat is statically prerendered with
 * `export const revalidate = 60` (src/app/(site)/eat/page.tsx) and nothing in
 * the approve path calls revalidatePath, so publishing is picked up by
 * TIME-BASED stale-while-revalidate: once the entry is older than the window
 * the next request still serves the STALE page and only schedules the
 * regeneration — the request after that gets the new copy. A naive
 * assert-once would therefore fail for cache reasons rather than product ones.
 *
 * Deliberately NOT worked around: `cache-control: no-cache` on the REQUEST
 * does not bypass Next's full route cache (only the `x-prerender-revalidate`
 * flow and revalidateTag/Path do), and a cache-busting query string would
 * assert against a URL no visitor ever loads. So this asserts the real public
 * URL and waits out the real window — worst case a little over `revalidate`.
 */
async function waitForEatToServe(text: string, timeoutMs = 150_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let html = "";
  for (;;) {
    html = await getPublicHtml("/eat");
    if (html.includes(text)) return html;
    if (Date.now() >= deadline) return html;
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

/**
 * Wait for an ACTION's own success message and hand it back to be asserted on.
 *
 * Deliberately not `waitForSelector("text=Approved")`: Playwright's text
 * engine is a case-insensitive SUBSTRING match over the whole page, and
 * /admin/worklist's own page intro ends "…until it's approved here". That
 * bare wait matched the intro the instant the page loaded, so it proved
 * nothing and let the walk race the POST it was supposed to be waiting for.
 * Every confirmation in these UIs is rendered into a role="status" live
 * region, so wait on that instead — and time out loudly if the action failed,
 * because a failure message never contains the success phrase.
 */
async function statusMessage(page: Page, phrase: string): Promise<string> {
  const region = page.locator(`[role="status"]:has-text("${phrase}")`).first();
  await region.waitFor({ state: "visible", timeout: 30_000 });
  return region.innerText();
}

/** One worklist item as the admin API serializes it — only the fields this
 *  walk reads. `subject` is the any-status STORED record, which is what makes
 *  the "held, not published" check independent of any page cache. */
interface WorklistItemJson {
  id: string;
  type: string;
  state: string;
  subjectStore: string;
  subjectId: string;
  payload: { kind?: string; proposed?: { description?: string } };
  subject: { description?: string } | null;
}

async function activeModerationItems(): Promise<WorklistItemJson[]> {
  const res = await adminContext.request.get(
    `${BASE_URL}/api/admin/worklist?type=moderation&state=active`,
  );
  expect(res.status(), "the admin worklist API must answer an authenticated admin").toBe(200);
  const body = (await res.json()) as { items?: WorklistItemJson[] };
  return body.items ?? [];
}

/* --------------------------------- setup --------------------------------- */

beforeAll(async () => {
  browser = await chromium.launch();
  adminContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  // Minted, not logged in — see tests/server/admin-session.ts.
  await signInAdmin(adminContext);
  adminPage = await adminContext.newPage();
  // Approve / release / "record as invited" are all window.confirm-gated.
  adminPage.on("dialog", (d) => void d.accept());
});

afterAll(async () => {
  await browser?.close();
});

/* ---------------------------------- walk ---------------------------------- */

describe("business onboarding, end to end", () => {
  it("uses a real seed listing (guard: keeps every later step honest)", () => {
    expect(LISTING, "the seed restaurant this walk drives must still exist").toBeTruthy();
    expect(
      LISTING.description,
      "OLD_SNIPPET must still be part of the seed description, or step 5 proves nothing",
    ).toContain(OLD_SNIPPET);
    expect(
      NEW_DESCRIPTION,
      "the proposed copy must differ from the seed copy",
    ).not.toBe(LISTING.description);
  });

  it("1. a public claim request opens a console item and grants nothing", async () => {
    const res = await fetch(`${BASE_URL}/api/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store: "restaurants",
        id: LISTING.id,
        businessName: LISTING.name,
        contactName: OWNER_NAME,
        contact: OWNER_EMAIL,
        message: `Onboarding walk ${RUN}: I own this and would like to manage the listing.`,
      }),
    });

    expect(res.status, "step 1: POST /api/claim must accept a well-formed request").toBe(200);
    expect(
      await res.json(),
      "step 1: intake must acknowledge the request as pending, not as granted",
    ).toEqual({ ok: true, pending: true });
    // The whole point of the intake: asking is not claiming. No session, no
    // account, no cookie of any kind comes back.
    expect(
      res.headers.get("set-cookie"),
      "step 1: a claim REQUEST must grant nothing — no cookie may be set",
    ).toBeNull();

    // …and the Chamber can see it. The console is where the operator picks it up.
    await adminPage.goto(`${BASE_URL}/admin/claims`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Claims console")', { timeout: 20_000 });
    await adminPage.waitForSelector("text=Claim requests waiting", { timeout: 20_000 });

    // Find the card by the requester's contact (unique to this run) so this
    // cannot pass by matching the listing's own row in the table below.
    const card = adminPage.locator("li").filter({ hasText: OWNER_EMAIL }).first();
    const cardText = await card.innerText();
    expect(
      cardText,
      "step 1: the open request must name the listing it is about",
    ).toContain(LISTING.name);
    expect(
      cardText,
      "step 1: the open request must carry the requester's callback contact",
    ).toContain(OWNER_EMAIL);
  });

  it("2. the Chamber mints a bound invite from the console and gets a join link", async () => {
    await adminPage.goto(`${BASE_URL}/admin/claims`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Claims console")', { timeout: 20_000 });

    const inviteButton = adminPage.locator(
      `button[aria-label="Invite the owner of ${LISTING.name} to claim it"]`,
    );
    expect(
      await inviteButton.count(),
      "step 2: an unclaimed listing must offer its row's invite control",
    ).toBe(1);
    await inviteButton.click();

    // Bind the code to the requester's address — a forwarded copy is then
    // useless to anyone else, and step 3 has to satisfy that binding.
    // The search box is type=search, so this is the panel's only email input.
    await adminPage.locator('input[type="email"]').fill(OWNER_EMAIL);
    await adminPage.locator('button:has-text("Create invite")').click();

    // The join link's <code> exists ONLY in the minted-invite panel, so
    // waiting for it is the success wait and the evidence at once.
    const minted = adminPage.locator("code").filter({ hasText: "/portal/join?code=" }).first();
    await minted.waitFor({ state: "visible", timeout: 20_000 });
    joinLink = (await minted.innerText()).trim();
    expect(
      joinLink,
      "step 2: the success panel must hand the operator a copyable join link",
    ).toContain("/portal/join?code=");
    inviteCode = new URL(joinLink).searchParams.get("code") ?? "";
    expect(inviteCode.length, "step 2: the join link must carry a code").toBeGreaterThan(0);

    // The console's own closing instruction is "record the outcome as
    // 'invited' on the worklist" — so the walk takes that step too. It proves
    // the claim item is really resolvable from the queue, and it stops this
    // suite leaving an open item in the shared queue other suites render.
    await adminPage.goto(`${BASE_URL}/admin/worklist`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Worklist")', { timeout: 20_000 });
    const queueItem = adminPage.locator("li").filter({ hasText: LISTING.name }).first();
    await queueItem.locator("button").first().click();
    expect(
      await queueItem.innerText(),
      "step 2: the queue item must carry the requester's details for the callback",
    ).toContain(OWNER_EMAIL);
    await queueItem.locator('button:has-text("Invited")').click();
    expect(
      await statusMessage(adminPage, "Recorded as invited"),
      "step 2: the queue must confirm the outcome was recorded",
    ).toContain("Recorded as invited");

    await adminPage.goto(`${BASE_URL}/admin/claims`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Claims console")', { timeout: 20_000 });
    expect(
      await adminPage.locator(`text=${OWNER_EMAIL}`).count(),
      "step 2: recording the outcome must clear the request from the console",
    ).toBe(0);
  });

  it("3. the owner redeems the link in a fresh browser and lands in the portal", async () => {
    // FRESH context: no admin cookie, no shared storage. This is a stranger.
    ownerContext = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    expect(
      (await ownerContext.cookies()).length,
      "step 3: the redeeming browser must start with no session at all",
    ).toBe(0);
    ownerPage = await ownerContext.newPage();

    await ownerPage.goto(joinLink, { waitUntil: "load" });
    expect(
      await ownerPage.locator("#join-code").inputValue(),
      "step 3: the ?code= link must arrive with the code pre-filled",
    ).toBe(inviteCode);

    await ownerPage.locator("#join-name").fill(OWNER_NAME);
    await ownerPage.locator("#join-email").fill(OWNER_EMAIL);
    await ownerPage.locator("#join-password").fill(OWNER_PASSWORD);
    await ownerPage.locator('button:has-text("Create account")').click();

    // The form redirects on success; a rejected redemption stays put and
    // renders role="alert" instead, so this wait IS the success assertion.
    await ownerPage.waitForURL(`${BASE_URL}/portal`, { timeout: 30_000 });

    const portal = await ownerPage.locator("body").innerText();
    expect(
      portal,
      "step 3: redemption must leave the owner signed in, greeted by name",
    ).toContain(`Hi, ${OWNER_NAME.split(" ")[0]}`);
    expect(
      portal,
      "step 3: a business member must land on their listing dashboard",
    ).toContain("My business");
    expect(
      portal,
      "step 3: redeeming a member invite must NOT hand out Chamber admin surfaces",
    ).not.toContain("Claims console");
  });

  it("4. the claim landed both halves, and a second mint is refused", async () => {
    await adminPage.goto(`${BASE_URL}/admin/claims`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Claims console")', { timeout: 20_000 });

    const row = adminPage.locator(`#claim-row-restaurants-${LISTING.id}`);
    const rowText = await row.innerText();
    expect(rowText, "step 4: the console must now read the listing as claimed").toContain(
      "Claimed",
    );
    // "Needs attention" is exactly what the console renders when the OWNER
    // STAMP (record.owner_org_id) and the EDIT GRANT (orgs.linked_ids)
    // disagree. Its absence is the assertion that redemption moved BOTH — a
    // half-landed claim would render here, not a clean "Claimed".
    expect(
      rowText,
      "step 4: owner stamp and edit grant must agree — a half-landed claim reads 'Needs attention'",
    ).not.toContain("Needs attention");
    expect(
      await row.locator(`button[aria-label="Release the claim on ${LISTING.name}"]`).count(),
      "step 4: a claimed row must offer the release control",
    ).toBe(1);
    expect(
      await row
        .locator(`button[aria-label="Invite the owner of ${LISTING.name} to claim it"]`)
        .count(),
      "step 4: a claimed row must no longer offer minting",
    ).toBe(0);

    // The console hides the control; the API must refuse the request anyway,
    // and its refusal is what step 7 undoes. This is also where the owning
    // organisation gets NAMED.
    const refused = await adminContext.request.post(`${BASE_URL}/api/portal/invites`, {
      data: { role: "member-business", linkedIds: [LISTING.id], newOrgName: LISTING.name },
    });
    expect(
      refused.status(),
      "step 4: minting a second invite over a claimed listing must be refused (409)",
    ).toBe(409);
    const refusedBody = (await refused.json()) as { error?: string };
    expect(
      refusedBody.error ?? "",
      "step 4: the refusal must name the listing that is already claimed",
    ).toContain(`${LISTING.id} is already claimed by`);
    expect(
      refusedBody.error ?? "",
      "step 4: the refusal must point at the release control that undoes it",
    ).toContain("/admin/claims");

    // The other half of "claimed": the owner can actually edit.
    await ownerPage.goto(`${BASE_URL}/portal/business/${LISTING.id}`, { waitUntil: "load" });
    expect(
      new URL(ownerPage.url()).pathname,
      "step 4: the owner must reach their editor, not be bounced back to /portal",
    ).toBe(`/portal/business/${LISTING.id}`);
    await ownerPage.waitForSelector(`h1:has-text("${LISTING.name}")`, { timeout: 20_000 });
    expect(
      await ownerPage.locator("textarea").first().inputValue(),
      "step 4: the editor must open on the live listing's own copy",
    ).toBe(LISTING.description);
    expect(
      await ownerPage.locator("body").innerText(),
      "step 4: a member must be told their edits are reviewed, not published",
    ).toContain("submitted for a quick Chamber review");
  });

  it(
    "5. the member's edit is held for review and the public page does not move",
    async () => {
      // ESTABLISH THE PUBLIC BASELINE FIRST — this is not ceremony.
      // Next flushes the ISR entry for /eat to disk INSIDE the standalone
      // build (.next/standalone/.next/server/app/eat.html), so it outlives
      // the run that wrote it: `npm run build` resets it, re-running
      // `test:server` against the same build does not. global-setup truncates
      // the record table, so the STORE is back to the seed — but a second run
      // can still find /eat serving the copy the PREVIOUS run published, and
      // the "unchanged" assertion below would then fail for cache reasons
      // rather than product ones (exactly what happened the first time this
      // suite ran twice). So wait for the public page to really be back on
      // the seed copy before touching the listing.
      const baseline = await waitForEatToServe(OLD_SNIPPET);
      expect(
        baseline,
        "step 5: /eat never returned to its seed copy — a hold cannot be proved from an unknown baseline",
      ).toContain(OLD_SNIPPET);

      await ownerPage.goto(`${BASE_URL}/portal/business/${LISTING.id}`, { waitUntil: "load" });
      await ownerPage.waitForSelector(`h1:has-text("${LISTING.name}")`, { timeout: 20_000 });
      await ownerPage.locator("textarea").first().fill(NEW_DESCRIPTION);
      await ownerPage.locator('button:has-text("Save details")').click();
      expect(
        await statusMessage(ownerPage, "goes live after Chamber review"),
        "step 5: the member must be told their save was SUBMITTED, never published",
      ).toContain("Submitted");

      // The public page, as a visitor gets it: still the old copy.
      const html = await getPublicHtml("/eat");
      expect(html, "step 5: the live listing must keep serving its old copy").toContain(
        OLD_SNIPPET,
      );
      expect(html, "step 5: a HELD edit must never reach the public page").not.toContain(
        NEW_DESCRIPTION,
      );

      // …and the same claim asked of the store, which no cache can flatter:
      // `subject` is the any-status STORED record and `payload.proposed` is
      // the revision waiting for review. THIS is the assertion that would
      // catch a regression where a member edit publishes straight away — the
      // HTML check above could pass on a warm cache alone.
      const items = await activeModerationItems();
      const held = items.find(
        (i) => i.subjectStore === "restaurants" && i.subjectId === LISTING.id,
      );
      expect(held, "step 5: the edit must open a moderation item on the worklist").toBeTruthy();
      expect(held!.payload.kind, "step 5: it must be held as an EDIT proposal").toBe("edit");
      expect(
        held!.payload.proposed?.description,
        "step 5: the item must carry the member's proposed copy",
      ).toBe(NEW_DESCRIPTION);
      expect(
        held!.subject?.description,
        "step 5: the STORED record must be untouched — a hold must not mutate live content",
      ).toBe(LISTING.description);
    },
    200_000,
  );

  it(
    "6. the Chamber approves it on the worklist and the public page follows",
    async () => {
      await adminPage.goto(`${BASE_URL}/admin/worklist`, { waitUntil: "load" });
      await adminPage.waitForSelector('h1:has-text("Worklist")', { timeout: 20_000 });

      const card = adminPage.locator("li").filter({ hasText: LISTING.name }).first();
      await card.locator("button").first().click();
      const detail = await card.innerText();
      expect(
        detail,
        "step 6: the reviewer must see the before/after diff, not a bare approve button",
      ).toContain("Proposed changes");
      expect(detail, "step 6: the diff must show the proposed copy").toContain(NEW_DESCRIPTION);
      expect(detail, "step 6: the diff must show what it replaces").toContain(OLD_SNIPPET);

      await card.locator('button:has-text("Approve")').click();
      const approved = await statusMessage(adminPage, "Approved");
      expect(
        approved,
        "step 6: approve must report a publish, not a re-validation reject",
      ).toContain("it's live");

      expect(
        (await activeModerationItems()).some((i) => i.subjectId === LISTING.id),
        "step 6: approving must close the item, not leave it queued",
      ).toBe(false);

      // See waitForEatToServe: /eat is ISR (revalidate 60) and nothing
      // revalidates it on write, so the publish reaches the public URL a
      // window later — this waits it out against the real URL a visitor uses.
      const html = await waitForEatToServe(NEW_DESCRIPTION);
      expect(
        html,
        "step 6: the approved copy must reach the public page (waited out /eat's ISR window)",
      ).toContain(NEW_DESCRIPTION);
      expect(
        html,
        "step 6: the superseded copy must be gone from the public page",
      ).not.toContain(OLD_SNIPPET);
    },
    200_000,
  );

  it("7. releasing the claim unclaims the listing and re-opens minting", async () => {
    await adminPage.goto(`${BASE_URL}/admin/claims`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Claims console")', { timeout: 20_000 });

    const row = adminPage.locator(`#claim-row-restaurants-${LISTING.id}`);
    await row.locator(`button[aria-label="Release the claim on ${LISTING.name}"]`).click();
    await adminPage.locator('button:has-text("Yes, release the claim")').click();
    expect(
      await statusMessage(adminPage, `Released the claim on ${LISTING.name}`),
      "step 7: the console must confirm the listing is invitable again",
    ).toContain("It is unclaimed again and can be invited.");

    // Re-read from the SERVER, not from the panel's optimistic state.
    await adminPage.goto(`${BASE_URL}/admin/claims`, { waitUntil: "load" });
    await adminPage.waitForSelector('h1:has-text("Claims console")', { timeout: 20_000 });
    const freshRow = adminPage.locator(`#claim-row-restaurants-${LISTING.id}`);
    const rowText = await freshRow.innerText();
    expect(rowText, "step 7: the listing must read unclaimed again").toContain("Unclaimed");
    expect(
      rowText,
      "step 7: release must move BOTH halves — a stranded grant reads 'Needs attention'",
    ).not.toContain("Needs attention");

    // Release means the business really loses access, not just the badge.
    await ownerPage.goto(`${BASE_URL}/portal/business/${LISTING.id}`, { waitUntil: "load" });
    expect(
      new URL(ownerPage.url()).pathname,
      "step 7: the released owner must no longer reach the listing editor",
    ).toBe("/portal");

    // And the round trip the refusal in step 4 promised: mintable again.
    const inviteButton = freshRow.locator(
      `button[aria-label="Invite the owner of ${LISTING.name} to claim it"]`,
    );
    expect(
      await inviteButton.count(),
      "step 7: a released listing must offer its invite control again",
    ).toBe(1);
    await inviteButton.click();
    await adminPage.locator('button:has-text("Create invite")').click();
    const reminted = adminPage.locator("code").filter({ hasText: "/portal/join?code=" }).first();
    await reminted.waitFor({ state: "visible", timeout: 20_000 });

    const secondLink = (await reminted.innerText()).trim();
    const secondCode = new URL(secondLink).searchParams.get("code") ?? "";
    expect(
      secondCode.length,
      "step 7: the re-mint must produce a usable join link",
    ).toBeGreaterThan(0);
    expect(secondCode, "step 7: the re-mint must be a NEW code, not the spent one").not.toBe(
      inviteCode,
    );
  });
});
