// Scarecrow Crawl vote route — the gates that have to hold while the crawl is
// live and nobody is watching the logs: the window, the id allowlist, the
// upload checks, and the rate limit.
//
// The clock is faked to a date INSIDE the crawl window; every test that
// expects anything other than 403 depends on that, and the closed-window test
// moves it deliberately.

import { rm } from "fs/promises";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Votes are Postgres-only — run over PGlite.
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";
import { dataPath } from "@/lib/data-dir";
import { CRAWL_VIEW_ID } from "@/lib/data/scarecrows";
import { saveMapFeature } from "@/lib/stores/map-store";
import {
  MAX_PHOTO_BYTES,
  getVoteCounts,
  listVotes,
  listVotesWithPhotos,
} from "@/lib/stores/scarecrow-store";
import { POST } from "@/app/api/scarecrow/vote/route";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// The crawl's entries are markers the Chamber puts on the crawl map view, so
// the fixture is a saved feature rather than a constant.
const ID = "scarecrow-test-entry";

/** Serialize a FormData the way the wire does — bytes plus the declared
 *  Content-Length every browser sends — so the route's pre-parse length guard
 *  sees what production sees. */
async function wireForm(form: FormData) {
  const wire = new Response(form);
  const body = await wire.arrayBuffer();
  return {
    body,
    headers: {
      "content-type": wire.headers.get("content-type") ?? "",
      "content-length": String(body.byteLength),
    },
  };
}

function emptyPost(ip: string) {
  return POST(
    new NextRequest("http://localhost/api/scarecrow/vote", {
      method: "POST",
      // A declared length with no parsable body: passes the length guard,
      // fails multipart parsing — the pre-parse 400 the rate-limit test needs.
      headers: { "x-forwarded-for": ip, "content-length": "100" },
    }),
  );
}

async function votePost(
  ip: string,
  fields: { scarecrowId?: string; photo?: File; socialOk?: string } = {},
) {
  const form = new FormData();
  form.set("scarecrowId", fields.scarecrowId ?? ID);
  if (fields.photo) form.set("photo", fields.photo);
  if (fields.socialOk !== undefined) form.set("socialOk", fields.socialOk);
  const { body, headers } = await wireForm(form);
  return POST(
    new NextRequest("http://localhost/api/scarecrow/vote", {
      method: "POST",
      body,
      headers: { ...headers, "x-forwarded-for": ip },
    }),
  );
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  await saveMapFeature({
    id: ID,
    kind: "marker",
    title: "Test scarecrow",
    notes: "Main Street",
    category: "event",
    views: [CRAWL_VIEW_ID],
    point: [47.798, -122.497],
  });
  // Mid-crawl: a Tuesday between the two Saturdays.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00-07:00"));
});
afterAll(async () => {
  vi.useRealTimers();
  await tdb.close();
  await rm(dataPath("scarecrow"), { recursive: true, force: true });
});
afterEach(() => {
  vi.setSystemTime(new Date("2026-10-20T12:00:00-07:00"));
});

describe("POST /api/scarecrow/vote", () => {
  it("records a vote without a photo", async () => {
    const res = await votePost("203.0.113.10");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await getVoteCounts())[ID]).toBeGreaterThan(0);
  });

  it("stores a photo with the vote", async () => {
    const before = (await listVotesWithPhotos()).length;
    const res = await votePost("203.0.113.11", {
      photo: new File([TINY_PNG], "scarecrow.png", { type: "image/png" }),
    });
    expect(res.status).toBe(200);
    expect((await listVotesWithPhotos()).length).toBe(before + 1);
  });

  it("records the visitor's answer about reposting the photo", async () => {
    const photo = () => new File([TINY_PNG], "scarecrow.png", { type: "image/png" });

    await votePost("203.0.113.30", { photo: photo(), socialOk: "true" });
    expect((await listVotesWithPhotos(1))[0].photoSocialOk).toBe(true);

    await votePost("203.0.113.31", { photo: photo(), socialOk: "false" });
    expect((await listVotesWithPhotos(1))[0].photoSocialOk).toBe(false);
  });

  it("treats a missing answer as NO, not as the form's default", async () => {
    // The page ticks the box, but a request that never says so is silence, and
    // silence about consent is a refusal.
    await votePost("203.0.113.32", {
      photo: new File([TINY_PNG], "scarecrow.png", { type: "image/png" }),
    });
    expect((await listVotesWithPhotos(1))[0].photoSocialOk).toBe(false);
  });

  it("leaves the answer unset when the vote carried no photo", async () => {
    // Nothing to give permission about — null, not false, so a later report
    // can tell "declined" from "never asked".
    const res = await votePost("203.0.113.33", { socialOk: "true" });
    expect(res.status).toBe(200);
    const [latest] = await listVotes(1);
    expect(latest.photoPath).toBeNull();
    expect(latest.photoSocialOk).toBeNull();
  });

  it("refuses an id that is not in the seed list (400)", async () => {
    const res = await votePost("203.0.113.12", { scarecrowId: "no-such-scarecrow" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown scarecrow/i);
  });

  it("refuses a marker that exists but is not on the crawl view (400)", async () => {
    // The allowlist is the crawl view, not the map: a pin on Explore Kingston
    // is not an entry in the contest.
    await saveMapFeature({
      id: "some-other-pin",
      kind: "marker",
      title: "A viewpoint",
      views: ["explore"],
      point: [47.799, -122.497],
    });
    const res = await votePost("203.0.113.20", { scarecrowId: "some-other-pin" });
    expect(res.status).toBe(400);
  });

  it("refuses a vote before the crawl opens, and after it closes (403)", async () => {
    vi.setSystemTime(new Date("2026-10-01T12:00:00-07:00"));
    const early = await votePost("203.0.113.13");
    expect(early.status).toBe(403);

    // One second past 5pm on the final Saturday.
    vi.setSystemTime(new Date("2026-10-31T17:00:01-07:00"));
    const late = await votePost("203.0.113.14");
    expect(late.status).toBe(403);
    expect((await late.json()).error).toMatch(/closed/i);
  });

  it("refuses a file that claims to be an image but is not (400, fail-closed)", async () => {
    const res = await votePost("203.0.113.15", {
      photo: new File([Buffer.from("MZ not an image at all")], "sneaky.png", {
        type: "image/png",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/could not be read/i);
  });

  it("refuses a file type we cannot strip metadata from (415)", async () => {
    const res = await votePost("203.0.113.16", {
      photo: new File([Buffer.from("%PDF-1.7")], "flyer.pdf", { type: "application/pdf" }),
    });
    expect(res.status).toBe(415);
  });

  it("refuses a request that declares no length (411) — before any parsing", async () => {
    const form = new FormData();
    form.set("scarecrowId", ID);
    const res = await POST(
      new NextRequest("http://localhost/api/scarecrow/vote", {
        method: "POST",
        body: form,
        headers: { "x-forwarded-for": "203.0.113.17" },
      }),
    );
    expect(res.status).toBe(411);
  });

  it("refuses a declared length over the photo budget (413) without parsing", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/scarecrow/vote", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.18",
          "content-length": String(MAX_PHOTO_BYTES * 4),
        },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("rate-limits one IP: 5 pre-parse 400s, then a 429", async () => {
    const ip = "203.0.113.19";
    for (let i = 0; i < 5; i++) {
      expect((await emptyPost(ip)).status).toBe(400);
    }
    const sixth = await emptyPost(ip);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
  });
});
