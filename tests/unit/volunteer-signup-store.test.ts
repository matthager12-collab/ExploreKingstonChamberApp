// E20 signup store against a real (PGlite) database — the enforcement layer
// for the charter's atomicity discipline: slot-cap concurrency, idempotent
// replay, cancel/auto-reopen, check-in state machine, reminder claims,
// retention anonymization, and the no-PII-in-audit hygiene rule.

import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audit } from "@/lib/db/schema";
import { adjustVolunteerSlots, setRecordStatus, writeRecord } from "@/lib/db/records";
import {
  activeSignupCount,
  anonymizeForShifts,
  anonymizeOlderThan,
  cancelSignup,
  checkInSignup,
  claimDueReminders,
  confirmSignup,
  createSignup,
  getSignup,
  listRoster,
} from "@/lib/stores/volunteer-signup-store";
import {
  anonymizeSignupsByEmail,
  findSignupsByEmail,
} from "@/lib/db/volunteer-signups";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const NANCY = "Neighbor Nancy";
const NANCY_EMAIL = "nancy@example.test";

let tdb: TestDb;
let keyCounter = 0;
const freshKey = () => `vitest-key-${String(keyCounter++).padStart(4, "0")}`;

async function seedShift(id: string, slotsTotal: number, status: "live" | "pending" = "live") {
  await writeRecord(
    "volunteer-needs",
    {
      id,
      charityId: "char-1",
      title: `Shift ${id}`,
      date: "2026-09-12T09:00:00-07:00",
      timeRange: "9:00 AM – 1:00 PM",
      slotsTotal,
      slotsFilled: 0,
      description: "",
    },
    { actor: "vitest-admin", source: "admin", status, action: "create" },
  );
}

function signupInput(shiftId: string, overrides: Partial<Parameters<typeof createSignup>[0]> = {}) {
  return {
    shiftId,
    name: NANCY,
    contact: NANCY_EMAIL,
    contactKind: "email" as const,
    idempotencyKey: freshKey(),
    ...overrides,
  };
}

beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("slot-cap concurrency (charter AC 6)", () => {
  it("20 concurrent signups on a 5-slot shift: exactly 5 succeed, counter = 5", async () => {
    await seedShift("conc", 5);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => createSignup(signupInput("conc"))),
    );
    const ok = results.filter((r) => r.ok);
    const full = results.filter((r) => !r.ok && r.reason === "full");
    expect(ok).toHaveLength(5);
    expect(full).toHaveLength(15);
    expect(await activeSignupCount("conc")).toBe(5);
    // The shared counter agrees: a 6th sequential attempt is refused.
    const sixth = await createSignup(signupInput("conc"));
    expect(sixth.ok).toBe(false);
  });
});

describe("idempotent replay (charter AC 7)", () => {
  it("same key three times: one row, same signupId, one increment", async () => {
    await seedShift("replay", 3);
    const key = freshKey();
    const first = await createSignup(signupInput("replay", { idempotencyKey: key }));
    const second = await createSignup(signupInput("replay", { idempotencyKey: key }));
    const third = await createSignup(signupInput("replay", { idempotencyKey: key }));
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (first.ok && second.ok && third.ok) {
      expect(second.signupId).toBe(first.signupId);
      expect(third.signupId).toBe(first.signupId);
      expect(second.replayed).toBe(true);
    }
    expect(await activeSignupCount("replay")).toBe(1);
    expect((await listRoster("replay")).length).toBe(1);
  });
});

describe("cancel / auto-reopen (charter AC 10)", () => {
  it("cancelling frees the slot; a new signup takes it; re-cancel decrements once", async () => {
    await seedShift("reopen", 1);
    const only = await createSignup(signupInput("reopen"));
    expect(only.ok).toBe(true);
    const refused = await createSignup(signupInput("reopen"));
    expect(refused.ok).toBe(false);

    const signupId = only.ok ? only.signupId : "";
    const cancelled = await cancelSignup(signupId);
    expect(cancelled.ok && !cancelled.alreadyCancelled).toBe(true);

    const again = await createSignup(signupInput("reopen"));
    expect(again.ok).toBe(true);

    // Double-cancel: idempotent, and the counter does NOT decrement twice.
    const recancel = await cancelSignup(signupId);
    expect(recancel.ok && recancel.alreadyCancelled).toBe(true);
    const third = await createSignup(signupInput("reopen"));
    expect(third.ok).toBe(false); // still exactly one slot, held by `again`
  });

  it("cancel still frees the slot on a hidden (taken-down) shift", async () => {
    await seedShift("hidden-cancel", 2);
    const s = await createSignup(signupInput("hidden-cancel"));
    expect(s.ok).toBe(true);
    await setRecordStatus("volunteer-needs", "hidden-cancel", "hidden", {
      actor: "vitest-admin",
      source: "admin",
    });
    const cancelled = await cancelSignup(s.ok ? s.signupId : "");
    expect(cancelled.ok).toBe(true);
    // …but new claims against the hidden shift are refused.
    const refused = await createSignup(signupInput("hidden-cancel"));
    expect(refused.ok).toBe(false);
  });
});

describe("check-in state machine (charter AC 11)", () => {
  it("checks in once, replays idempotently with checked_in_at unchanged", async () => {
    await seedShift("checkin", 2);
    const s = await createSignup(signupInput("checkin"));
    const id = s.ok ? s.signupId : "";

    const first = await checkInSignup(id, "self");
    expect(first.ok && !first.alreadyCheckedIn).toBe(true);
    const stamped = (await getSignup(id))?.checkedInAt;
    expect(stamped).toBeTruthy();

    const replay = await checkInSignup(id, "self");
    expect(replay.ok && replay.alreadyCheckedIn).toBe(true);
    expect((await getSignup(id))?.checkedInAt?.getTime()).toBe(stamped?.getTime());
  });

  it("a cancelled signup cannot check in; an unknown id reports not-found", async () => {
    await seedShift("checkin-cancelled", 2);
    const s = await createSignup(signupInput("checkin-cancelled"));
    const id = s.ok ? s.signupId : "";
    await cancelSignup(id);
    const denied = await checkInSignup(id, "self");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("cancelled");
    const missing = await checkInSignup("00000000-0000-4000-8000-000000000000", "self");
    expect(missing.ok).toBe(false);
  });

  it("confirm stamps once and keeps the original instant", async () => {
    await seedShift("confirm", 1);
    const s = await createSignup(signupInput("confirm"));
    const id = s.ok ? s.signupId : "";
    expect(await confirmSignup(id)).toBe(true);
    const stamped = (await getSignup(id))?.confirmedAt;
    expect(stamped).toBeTruthy();
    await confirmSignup(id);
    expect((await getSignup(id))?.confirmedAt?.getTime()).toBe(stamped?.getTime());
  });
});

describe("reminder claims (charter AC 13 substrate)", () => {
  it("claims email contacts once per kind; phone contacts never", async () => {
    await seedShift("remind", 5);
    await createSignup(signupInput("remind"));
    await createSignup(signupInput("remind", { contact: "second@example.test" }));
    await createSignup(
      signupInput("remind", { contact: "(360) 555-0100", contactKind: "phone" }),
    );

    const first = await claimDueReminders("2d", ["remind"]);
    expect(first).toHaveLength(2);
    expect(first.every((r) => r.contactKind === "email")).toBe(true);
    const second = await claimDueReminders("2d", ["remind"]);
    expect(second).toHaveLength(0);
    // The 2h pass claims independently of the 2d pass.
    const twoHour = await claimDueReminders("2h", ["remind"]);
    expect(twoHour).toHaveLength(2);
    // Empty shift list is a cheap no-op.
    expect(await claimDueReminders("2d", [])).toHaveLength(0);
  });
});

describe("retention + PII-inventory handlers (charter AC 14)", () => {
  it("anonymizeForShifts nulls PII, keeps state, runs once", async () => {
    await seedShift("retire", 3);
    const s = await createSignup(signupInput("retire"));
    const id = s.ok ? s.signupId : "";
    await checkInSignup(id, "self");

    expect(await anonymizeForShifts(["retire"])).toBe(1);
    const row = await getSignup(id);
    expect(row?.name).toBeNull();
    expect(row?.contact).toBeNull();
    expect(row?.state).toBe("checked_in"); // aggregate stats survive
    expect(row?.anonymizedAt).toBeTruthy();
    expect(await anonymizeForShifts(["retire"])).toBe(0);
    // Anonymized rows are invisible to the email-identifier lookup.
    expect(await findSignupsByEmail(NANCY_EMAIL)).not.toContainEqual(
      expect.objectContaining({ id }),
    );
  });

  it("anonymizeOlderThan is the tombstoned-shift backstop", async () => {
    await seedShift("orphan", 2);
    const s = await createSignup(signupInput("orphan", { contact: "orphan@example.test" }));
    const id = s.ok ? s.signupId : "";
    expect(await anonymizeOlderThan(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(1);
    expect((await getSignup(id))?.contact).toBeNull();
  });

  it("anonymizeSignupsByEmail scrubs only the requester's rows", async () => {
    await seedShift("gdpr", 4);
    await createSignup(signupInput("gdpr", { contact: "keep@example.test" }));
    const mine = await createSignup(signupInput("gdpr", { contact: "erase@example.test" }));
    const n = await anonymizeSignupsByEmail("erase@example.test", "privacy-fulfillment");
    expect(n).toBe(1);
    expect((await getSignup(mine.ok ? mine.signupId : ""))?.contact).toBeNull();
    expect((await findSignupsByEmail("keep@example.test")).length).toBe(1);
  });
});

describe("audit hygiene (charter step 11 — ids only, never PII)", () => {
  it("the whole trail contains no volunteer name or contact anywhere", async () => {
    const rows = await tdb.db.select().from(audit);
    const trail = JSON.stringify(rows);
    expect(trail).not.toContain(NANCY);
    expect(trail).not.toContain(NANCY_EMAIL);
    expect(trail).not.toContain("erase@example.test");
    expect(trail).not.toContain("(360) 555-0100");
    // …and the trail did record the lifecycle (by id).
    const [{ n }] = await tdb.db.select({ n: count() }).from(audit);
    expect(n).toBeGreaterThan(10);
  });
});

describe("adjustVolunteerSlots guards (records.ts primitive)", () => {
  it("refuses claims on pending shifts and unknown ids; floors at zero", async () => {
    await seedShift("pending-shift", 5, "pending");
    expect(
      await adjustVolunteerSlots("pending-shift", 1, { actor: "t", source: "public" }),
    ).toBeNull();
    expect(
      await adjustVolunteerSlots("no-such-shift", 1, { actor: "t", source: "public" }),
    ).toBeNull();
    await seedShift("floor", 2);
    expect(await adjustVolunteerSlots("floor", -1, { actor: "t", source: "public" })).toBeNull();
  });
});
