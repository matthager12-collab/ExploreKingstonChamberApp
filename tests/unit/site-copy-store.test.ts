// site-copy store — the auto-restore (lazy expiry) contract.
//
// An override carries an optional expiresAt ("YYYY-MM-DD", Pacific). On/after
// that date it's ignored at read time and the block falls back to the code
// wording — no scheduler. Runs against in-memory PGlite like the other store
// suites. Dates 2000-01-01 (always past) and 2999-12-31 (always future) keep
// the assertions independent of the wall clock.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import {
  saveCopyOverride,
  getCopyOverrides,
  getCopyOverridesDetailed,
} from "@/lib/stores/site-store";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

describe("site-copy store — auto-restore expiry", () => {
  it("keeps an override with no revert date", async () => {
    await saveCopyOverride("eat.header.intro", "Custom eat intro");
    expect((await getCopyOverrides())["eat.header.intro"]).toBe("Custom eat intro");
    expect((await getCopyOverridesDetailed())["eat.header.intro"]).toEqual({
      text: "Custom eat intro",
    });
  });

  it("keeps an override whose revert date is in the future, and surfaces the date", async () => {
    await saveCopyOverride("ferry.header.title", "Boats", { expiresAt: "2999-12-31" });
    expect((await getCopyOverrides())["ferry.header.title"]).toBe("Boats");
    expect((await getCopyOverridesDetailed())["ferry.header.title"]).toEqual({
      text: "Boats",
      expiresAt: "2999-12-31",
    });
  });

  it("drops an override whose revert date has passed (→ falls back to code)", async () => {
    await saveCopyOverride("stay.header.title", "Sleep", { expiresAt: "2000-01-01" });
    expect((await getCopyOverrides())["stay.header.title"]).toBeUndefined();
    expect((await getCopyOverridesDetailed())["stay.header.title"]).toBeUndefined();
  });

  it("clears the revert date when the block is re-saved without one", async () => {
    await saveCopyOverride("about.header.title", "About", { expiresAt: "2999-12-31" });
    expect((await getCopyOverridesDetailed())["about.header.title"]?.expiresAt).toBe("2999-12-31");
    await saveCopyOverride("about.header.title", "About"); // no opts → expiry cleared
    expect((await getCopyOverridesDetailed())["about.header.title"]).toEqual({ text: "About" });
  });
});
