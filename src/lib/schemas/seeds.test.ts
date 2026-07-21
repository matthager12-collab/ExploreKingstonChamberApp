// Every git-committed seed record parses under its domain schema, and parsing
// is a no-op on it (same serialized bytes). This is the E17 import on-ramp and
// E05's quarantine contract: if a schema change would send a seed to
// quarantine, this test fails the build first. If a seed record ever fails
// here, fix the schema — only touch seed content if it is genuinely malformed,
// and say so in the PR.

import { describe, expect, it } from "vitest";
import { events } from "@/lib/data/events";
import { itineraries } from "@/lib/data/itineraries";
import { lodging } from "@/lib/data/lodging";
import { restaurants } from "@/lib/data/restaurants";
import { webcams } from "@/lib/data/webcams";
import { DOMAIN_SCHEMAS, firstZodMessage } from "./index";

const SUITES = [
  { domain: "restaurants" as const, records: restaurants },
  { domain: "lodging" as const, records: lodging },
  { domain: "webcams" as const, records: webcams },
  { domain: "itineraries" as const, records: itineraries },
  { domain: "events" as const, records: events },
];

describe("seed data parses under the domain schemas", () => {
  for (const { domain, records } of SUITES) {
    it(`${domain}: all ${records.length} seed records parse and round-trip`, () => {
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const result = DOMAIN_SCHEMAS[domain].safeParse(record);
        expect(
          result.success,
          `${domain}/${record.id}: ${result.success ? "" : firstZodMessage(result.error)}`,
        ).toBe(true);
        if (!result.success) continue;
        // Parsing a canonical seed must not change its serialized form —
        // otherwise an import would silently rewrite committed content.
        expect(JSON.parse(JSON.stringify(result.data))).toEqual(
          JSON.parse(JSON.stringify(record)),
        );
      }
    });
  }
});
