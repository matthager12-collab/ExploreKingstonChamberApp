// E20 — the flag-off no-op proof (charter AC 15): with
// VOLUNTEER_SIGNUP_ENABLED unset, /give renders the pre-E20 mailto CTA and
// no signup form; with "1", the form renders and the mailto survives only as
// the in-form fallback. Rendered against real (PGlite) data — the CTA block
// is compared as markup, exactly as the AC prescribes (never a cross-commit
// byte-diff of the whole page).

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import GiveBackPage from "@/app/(site)/give/page";
import { writeRecord } from "@/lib/db/records";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;

beforeAll(async () => {
  tdb = await createTestDb();
  await writeRecord(
    "charities",
    { id: "flag-char", name: "Flag Charity", mission: "help", contactEmail: "org@example.test" },
    { actor: "vitest-admin", source: "admin", status: "live", action: "create" },
  );
  await writeRecord(
    "volunteer-needs",
    {
      id: "flag-shift",
      charityId: "flag-char",
      title: "Flag-test shift",
      date: "2027-06-12T09:00:00-07:00",
      timeRange: "9:00 AM – 1:00 PM",
      slotsTotal: 5,
      slotsFilled: 0,
      description: "",
    },
    { actor: "vitest-admin", source: "admin", status: "live", action: "create" },
  );
});
afterAll(async () => {
  delete process.env.VOLUNTEER_SIGNUP_ENABLED;
  await tdb.close();
});

describe("/give flag gate (AC 15)", () => {
  it("flag off: the mailto CTA renders, no signup form", async () => {
    delete process.env.VOLUNTEER_SIGNUP_ENABLED;
    const html = renderToStaticMarkup(await GiveBackPage());
    expect(html).toContain("Raise your hand");
    expect(html).toContain("mailto:org@example.test");
    expect(html).not.toContain("I can help");
    expect(html).not.toContain("volunteer-signup-form");
  });

  it("flag on: the signup entry point renders on the shift card", async () => {
    process.env.VOLUNTEER_SIGNUP_ENABLED = "1";
    const html = renderToStaticMarkup(await GiveBackPage());
    expect(html).toContain("I can help");
    // The card-level mailto CTA is gone (it lives on inside the form's
    // full-shift fallback, which only renders after a 409).
    expect(html).not.toContain("Raise your hand");
  });
});
