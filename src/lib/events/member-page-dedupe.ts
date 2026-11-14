import { createHash } from "node:crypto";

/**
 * Stable identity for a drafted event: its start, `YYYY-MM-DDTHH:MM`.
 *
 * Not the title. The model rewords titles between runs ("Jonas Solo" one day,
 * "Jonas Myers – Solo Piano" the next), and a title-based key would bring a
 * dismissed or published event back every morning. Combined with the
 * (owner_id, dedupe_key) unique index, this means one draft per start time per
 * listing.
 * ponytail: two different events at the same minute on one page collapse to
 * one draft; key on venue too if a member ever runs parallel rooms.
 */
export function draftDedupeKey(start: string): string {
  return createHash("sha256").update(start.slice(0, 16)).digest("hex");
}
