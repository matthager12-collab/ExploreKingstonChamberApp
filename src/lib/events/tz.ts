// Pure Intl-based timezone math for the events core (E12). No dependency —
// the rrule package is deliberately kept to pure recurrence arithmetic
// (rrule-expand.ts) and never trusted with zones, and src/lib/time.ts is
// frozen (.agent-frozen), so the core carries its own helpers.
//
// Everything here is a pure function of its inputs; nothing reads the clock.

/** Minutes east of UTC that `zone` observes at `instant`.
 *  (America/Los_Angeles: -420 in PDT, -480 in PST.) */
export function zoneOffsetMinutes(zone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant at which `zone`'s wall clock reads the given components —
 * the DST-correct inverse of "format this instant in zone".
 *
 * Two-pass fixpoint: guess the offset at the naive-UTC reading, re-check at
 * the corrected instant. Converges everywhere except inside a transition:
 * in the spring-forward gap (a wall time that never happens) and the
 * fall-back fold (a wall time that happens twice) the SECOND pass wins,
 * which resolves both deterministically to the post-transition offset.
 */
export function wallTimeToInstant(
  zone: string,
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const guess = new Date(naive - zoneOffsetMinutes(zone, new Date(naive)) * 60_000);
  return new Date(naive - zoneOffsetMinutes(zone, guess) * 60_000);
}

/** Wall-clock components `instant` reads in `zone`. */
export function instantToWallTime(
  zone: string,
  instant: Date,
): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    y: parts.year,
    mo: parts.month,
    d: parts.day,
    h: parts.hour,
    mi: parts.minute,
    s: parts.second,
  };
}

const PACIFIC = "America/Los_Angeles";
const pacificDay = new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC });

/** Pacific calendar date ("YYYY-MM-DD") for an event timestamp. Same contract
 *  as event-store's private helper: offset-carrying ISO strings format in
 *  Pacific; naive strings keep their intended wall-clock date by slicing. */
export function pacificDateKey(iso: string): string {
  if (!/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return iso.slice(0, 10);
  return pacificDay.format(new Date(iso));
}

/** ISO instant → UTC basic format ("20260704T221500Z") — occurrence-key and
 *  ICS stamps. */
export function toUtcBasic(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
