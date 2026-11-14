import { createHash } from "node:crypto";

/**
 * Stable identity for a drafted event.
 *
 *   one-off with a time    start minute, `YYYY-MM-DDTHH:MM`
 *   one-off without a time `YYYY-MM-DD|untimed`
 *   series                 `<rrule>|HH:MM` (or `|untimed`) — NOT the date: a
 *                          series' first occurrence moves every week, and a date
 *                          in the key would bring a dismissed series back daily.
 *
 * Not the title. The model rewords titles between runs ("Jonas Solo" one day,
 * "Jonas Myers – Solo Piano" the next), and a title-based key would bring a
 * dismissed or published event back every morning. Combined with the
 * (owner_id, dedupe_key) unique index, this means one draft per start time per
 * listing.
 * ponytail: two different events at the same minute on one page collapse to
 * one draft; key on venue too if a member ever runs parallel rooms.
 */
export function draftDedupeKey(
  start: string,
  opts: { rrule?: string | null; timeMissing?: boolean } = {},
): string {
  const time = opts.timeMissing ? "untimed" : start.slice(11, 16);
  let key: string;
  if (opts.rrule) key = `${opts.rrule}|${time}`;
  else if (opts.timeMissing) key = `${start.slice(0, 10)}|untimed`;
  else key = start.slice(0, 16); // unchanged, so existing drafts keep their keys
  return createHash("sha256").update(key).digest("hex");
}
