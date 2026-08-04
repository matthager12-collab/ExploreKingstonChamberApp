// E20 slice 2 — the public volunteer routes against PGlite: the no-account
// floor, header-only idempotency, live-only gating, 409/410 semantics,
// purpose-scoped manage tokens, the PII-free needs feed, rate limiting, and
// the ship-dark flag (routes 404 when it is off).

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as signupPOST } from "@/app/api/volunteer/signup/route";
import { POST as managePOST } from "@/app/api/volunteer/manage/route";
import { GET as needsGET } from "@/app/api/volunteer/needs/route";
import { writeRecord } from "@/lib/db/records";
import { signupActionToken } from "@/lib/volunteer-links";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
let ipCounter = 0;
let keyCounter = 0;
const freshKey = () => `route-key-${String(keyCounter++).padStart(4, "0")}`;

function jsonReq(
  url: string,
  body: unknown,
  opts: { key?: string | null; ip?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Unique IP per call unless a test wants to share a bucket — the
    // in-memory rate limiter is process-wide and must not leak across tests.
    "x-forwarded-for": opts.ip ?? `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
  };
  if (opts.key !== null) headers["X-Idempotency-Key"] = opts.key ?? freshKey();
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function seedShift(
  id: string,
  opts: { slots?: number; status?: "live" | "pending"; date?: string } = {},
) {
  await writeRecord(
    "volunteer-needs",
    {
      id,
      charityId: "char-r",
      title: `Shift ${id}`,
      date: opts.date ?? "2027-06-12T09:00:00-07:00",
      timeRange: "9:00 AM – 1:00 PM",
      slotsTotal: opts.slots ?? 5,
      slotsFilled: 0,
      description: "",
    },
    { actor: "vitest-admin", source: "admin", status: opts.status ?? "live", action: "create" },
  );
}

const GOOD = (shiftId: string) => ({
  shiftId,
  name: "Route Tester",
  contact: "route@example.test",
});

beforeAll(async () => {
  tdb = await createTestDb();
  process.env.VOLUNTEER_SIGNUP_ENABLED = "1";
  process.env.VOLUNTEER_LINK_SECRET = "vitest-volunteer-secret";
  await writeRecord(
    "charities",
    { id: "char-r", name: "Route Charity", mission: "help" },
    { actor: "vitest-admin", source: "admin", status: "live", action: "create" },
  );
});
afterAll(async () => {
  delete process.env.VOLUNTEER_SIGNUP_ENABLED;
  delete process.env.VOLUNTEER_LINK_SECRET;
  await tdb.close();
});

describe("POST /api/volunteer/signup", () => {
  it("signs up with no cookies, replays by header key, and never double-claims", async () => {
    await seedShift("r-happy");
    const key = freshKey();
    const first = await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-happy"), { key }));
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a.ok).toBe(true);
    expect(a.spotsLeft).toBe(4);

    const replay = await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-happy"), { key }));
    const b = await replay.json();
    expect(replay.status).toBe(200);
    expect(b.signupId).toBe(a.signupId);
    expect(b.spotsLeft).toBe(4); // did not increment twice
  });

  it("requires the header (400) and rejects malformed keys", async () => {
    await seedShift("r-key");
    const missing = await signupPOST(
      jsonReq("/api/volunteer/signup", GOOD("r-key"), { key: null }),
    );
    expect(missing.status).toBe(400);
    const short = await signupPOST(
      jsonReq("/api/volunteer/signup", GOOD("r-key"), { key: "abc" }),
    );
    expect(short.status).toBe(400);
  });

  it("rejects extra body fields — including a body-field idempotencyKey", async () => {
    await seedShift("r-strict");
    const extra = await signupPOST(
      jsonReq("/api/volunteer/signup", { ...GOOD("r-strict"), address: "nope" }),
    );
    expect(extra.status).toBe(400);
    const bodyKey = await signupPOST(
      jsonReq("/api/volunteer/signup", { ...GOOD("r-strict"), idempotencyKey: "in-body-00" }),
    );
    expect(bodyKey.status).toBe(400);
  });

  it("rejects a contact that is neither email nor phone", async () => {
    await seedShift("r-contact");
    const res = await signupPOST(
      jsonReq("/api/volunteer/signup", { ...GOOD("r-contact"), contact: "not-a-contact" }),
    );
    expect(res.status).toBe(400);
  });

  it("404s pending shifts and unknown ids; 410s past shifts; 409s full ones", async () => {
    await seedShift("r-pending", { status: "pending" });
    expect(
      (await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-pending")))).status,
    ).toBe(404);
    expect(
      (await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-none")))).status,
    ).toBe(404);

    await seedShift("r-past", { date: "2024-01-01T09:00:00-08:00" });
    expect(
      (await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-past")))).status,
    ).toBe(410);

    await seedShift("r-full", { slots: 1 });
    await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-full")));
    const full = await signupPOST(jsonReq("/api/volunteer/signup", GOOD("r-full")));
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ ok: false, reason: "full", spotsLeft: 0 });
  });

  it("rate-limits a single IP (AC 16)", async () => {
    await seedShift("r-limit", { slots: 999 });
    const ip = "10.99.99.99";
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await signupPOST(
        jsonReq("/api/volunteer/signup", GOOD("r-limit"), { ip }),
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe("POST /api/volunteer/manage", () => {
  async function makeSignup(shiftId: string): Promise<string> {
    await seedShift(shiftId, { slots: 2 });
    const res = await signupPOST(jsonReq("/api/volunteer/signup", GOOD(shiftId)));
    return (await res.json()).signupId as string;
  }

  it("cancel with the right token frees the slot; wrong purpose and tampering 403", async () => {
    const signupId = await makeSignup("m-cancel");
    const wrongPurpose = await managePOST(
      jsonReq("/api/volunteer/manage", {
        signupId,
        token: signupActionToken(signupId, "checkin"),
        action: "cancel",
      }),
    );
    expect(wrongPurpose.status).toBe(403);

    const tampered = await managePOST(
      jsonReq("/api/volunteer/manage", { signupId, token: "AAAA", action: "cancel" }),
    );
    expect(tampered.status).toBe(403);

    const ok = await managePOST(
      jsonReq("/api/volunteer/manage", {
        signupId,
        token: signupActionToken(signupId, "cancel"),
        action: "cancel",
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, cancelled: true, already: false });

    // Idempotent re-cancel.
    const again = await managePOST(
      jsonReq("/api/volunteer/manage", {
        signupId,
        token: signupActionToken(signupId, "cancel"),
        action: "cancel",
      }),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, already: true });

    // The slot reopened: a fresh signup on the 2-slot shift succeeds twice.
    expect(
      (await signupPOST(jsonReq("/api/volunteer/signup", GOOD("m-cancel")))).status,
    ).toBe(200);
  });

  it("confirm stamps and reports truthfully after cancellation", async () => {
    const signupId = await makeSignup("m-confirm");
    const ok = await managePOST(
      jsonReq("/api/volunteer/manage", {
        signupId,
        token: signupActionToken(signupId, "confirm"),
        action: "confirm",
      }),
    );
    expect(await ok.json()).toMatchObject({ ok: true, confirmed: true });

    await managePOST(
      jsonReq("/api/volunteer/manage", {
        signupId,
        token: signupActionToken(signupId, "cancel"),
        action: "cancel",
      }),
    );
    const after = await managePOST(
      jsonReq("/api/volunteer/manage", {
        signupId,
        token: signupActionToken(signupId, "confirm"),
        action: "confirm",
      }),
    );
    expect(await after.json()).toMatchObject({ ok: true, confirmed: false });
  });
});

describe("GET /api/volunteer/needs", () => {
  it("lists live upcoming shifts with spotsLeft and zero PII keys", async () => {
    await seedShift("n-live", { slots: 3 });
    await seedShift("n-pending", { status: "pending" });
    await seedShift("n-past", { date: "2024-01-01T09:00:00-08:00" });
    await signupPOST(jsonReq("/api/volunteer/signup", GOOD("n-live")));

    const res = await needsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.shifts.map((s: { id: string }) => s.id);
    expect(ids).toContain("n-live");
    expect(ids).not.toContain("n-pending");
    expect(ids).not.toContain("n-past");
    const live = body.shifts.find((s: { id: string }) => s.id === "n-live");
    expect(live).toMatchObject({ charityName: "Route Charity", spotsLeft: 2 });

    const text = JSON.stringify(body);
    expect(text).not.toContain('"name"'); // shift "title", never a person's name
    expect(text).not.toContain('"contact"');
    expect(text).not.toContain("route@example.test");
  });
});

describe("ship-dark flag (charter: dark means dark)", () => {
  it("all three routes 404 with the flag off", async () => {
    delete process.env.VOLUNTEER_SIGNUP_ENABLED;
    try {
      await seedShift("dark");
      expect(
        (await signupPOST(jsonReq("/api/volunteer/signup", GOOD("dark")))).status,
      ).toBe(404);
      expect(
        (
          await managePOST(
            jsonReq("/api/volunteer/manage", {
              signupId: "3b241101-e2bb-4255-8caf-4136c566a962",
              token: "x",
              action: "cancel",
            }),
          )
        ).status,
      ).toBe(404);
      expect((await needsGET()).status).toBe(404);
    } finally {
      process.env.VOLUNTEER_SIGNUP_ENABLED = "1";
    }
  });
});
