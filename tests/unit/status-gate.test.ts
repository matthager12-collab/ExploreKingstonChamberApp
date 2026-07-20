// status-gate (E05): every render path is status-gated — readMergedRecords
// only merges `live` overlay rows, while readRecords defaults to any-status
// (the contract auth and hunt-store depend on; trap #8 in the epic).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readMergedRecords, readRecords, writeRecord } from "@/lib/db/records";
import { validLodging, validWebcam } from "../setup/domain-docs";
import { createTestDb, type TestDb } from "../setup/pglite-db";

type Row = { id: string; name: string };

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("status gate", () => {
  it("a pending record is invisible to readMergedRecords but visible to raw reads", async () => {
    const seed: Row[] = [{ id: "town-inn", name: "Town Inn (seed)" }];
    await writeRecord(
      "lodging",
      validLodging({ id: "town-inn", name: "Town Inn (pending edit)" }),
      { status: "pending", actor: "owner@example.test", source: "portal" },
    );
    await writeRecord(
      "lodging",
      validLodging({ id: "new-camp", name: "New Camp (pending)", type: "camping" }),
      { status: "pending", source: "portal" },
    );

    // Render path: pending rows don't merge — the seed version still shows,
    // the pending-only record doesn't exist.
    const merged = await readMergedRecords("lodging", seed);
    expect(merged).toEqual(seed);

    // Any-status read (auth/hunt contract + future moderation queue) sees them.
    const all = await readRecords<Row>("lodging");
    expect(all.map((r) => r.id).sort()).toEqual(["new-camp", "town-inn"]);

    // Explicit status filters work both ways.
    const pending = await readRecords<Row>("lodging", { statuses: ["pending"] });
    expect(pending).toHaveLength(2);
    const live = await readRecords<Row>("lodging", { statuses: ["live"] });
    expect(live).toHaveLength(0);
  });

  it("live records merge exactly as before — the gate is behavior-preserving for this epic's all-live writes", async () => {
    const harborCam = validWebcam({ id: "harbor", name: "Harbor Cam" });
    await writeRecord("webcams", harborCam);
    const merged = await readMergedRecords<Row>("webcams", []);
    expect(merged).toEqual([harborCam]);
  });
});
