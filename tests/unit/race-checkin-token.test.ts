// Race-day link token: signature, expiry, version binding and the database
// half (readCheckinAccess) that makes minting or revoking kill older links.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { race } from "@/lib/data/race";
import { mintCheckinLink, revokeCheckinLink } from "@/lib/db/race-registrants";
import { readCheckinAccess } from "@/lib/race/checkin-access";
import { checkinCookieOptions, makeCheckinToken, verifyCheckinToken } from "@/lib/race/checkin-token";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const SECRET = "test-secret-for-race-links";
const NOW = 1_789_600_000_000;

let tdb: TestDb;
beforeAll(async () => {
  process.env.AUTH_SECRET = SECRET;
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("token", () => {
  it("round-trips and rejects tampering, another secret, and expiry", () => {
    const token = makeCheckinToken({ raceId: "r", v: 2, exp: NOW + 60_000 }, SECRET);
    expect(verifyCheckinToken(token, SECRET, NOW)).toEqual({ raceId: "r", v: 2, exp: NOW + 60_000 });
    expect(verifyCheckinToken(token, "other-secret", NOW)).toBeNull();
    expect(verifyCheckinToken(token, SECRET, NOW + 60_001)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ raceId: "r", v: 3, exp: NOW + 60_000 })).toString("base64url")}.${sig}`;
    expect(verifyCheckinToken(forged, SECRET, NOW)).toBeNull();
    expect(verifyCheckinToken(`${payload}.`, SECRET, NOW)).toBeNull();
    expect(verifyCheckinToken("garbage", SECRET, NOW)).toBeNull();
  });

  it("cookie lifetime follows the token expiry and is HttpOnly + Lax", () => {
    const opts = checkinCookieOptions(NOW + 90_000, NOW);
    expect(opts.maxAge).toBe(90);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
  });
});

describe("readCheckinAccess", () => {
  it("honours only the current link version and dies on mint or revoke", async () => {
    const exp = NOW + 3_600_000;
    const first = await mintCheckinLink(race.id, new Date(exp), "user-1");
    const token1 = makeCheckinToken({ raceId: race.id, v: first.version, exp }, SECRET);
    expect(await readCheckinAccess(token1, NOW)).toMatchObject({ v: first.version });
    expect(await readCheckinAccess(undefined, NOW)).toBeNull();
    expect(await readCheckinAccess(makeCheckinToken({ raceId: "other", v: first.version, exp }, SECRET), NOW)).toBeNull();

    const second = await mintCheckinLink(race.id, new Date(exp), "user-1");
    expect(await readCheckinAccess(token1, NOW)).toBeNull();
    const token2 = makeCheckinToken({ raceId: race.id, v: second.version, exp }, SECRET);
    expect(await readCheckinAccess(token2, NOW)).not.toBeNull();

    await revokeCheckinLink(race.id);
    expect(await readCheckinAccess(token2, NOW)).toBeNull();
  });
});
