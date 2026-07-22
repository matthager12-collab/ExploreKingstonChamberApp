// Kiosk numeric limits and their clamp — pure, so BOTH halves can share them.
//
// These live here rather than in src/lib/stores/kiosk-store.ts because that
// module imports json-store and therefore the database, which makes it
// unimportable from a client component. The admin control needs the same bounds
// it validates against that the server normalises with; splitting them left the
// two free to drift, and the drift would be invisible — the form would happily
// accept a value the store then silently rewrote.

/** Seconds of no touch before the kiosk resets to the attract loop. */
export const DEFAULT_IDLE_SECONDS = 90;

/**
 * Floor. Below about twenty seconds the reset fires while somebody is still
 * reading a listing — the device appears to snatch the page away, which reads
 * as broken rather than as a feature.
 */
export const MIN_IDLE_SECONDS = 20;

/**
 * Ceiling. Ten minutes is already long enough that the previous visitor's
 * screen is what the next one walks up to, and static pixels sitting for that
 * long are what the attract loop exists to prevent (docs/KIOSK.md §5).
 */
export const MAX_IDLE_SECONDS = 600;

/**
 * Coerce anything to a usable idle timeout. Junk becomes the DEFAULT, and
 * "junk" is decided before any numeric coercion happens — which is the whole
 * subtlety here.
 *
 * The obvious one-liner, `Number(value)`, is wrong in a way that bites exactly
 * the case this function exists for. Number(null), Number(undefined via ""),
 * Number("") and Number(false) are all 0 rather than NaN, so a record with a
 * MISSING idleSeconds — a restored backup, an older import, a hand-edited
 * overlay — would clamp to the FLOOR instead of the default, and the Chamber
 * would have a kiosk that wipes the screen every twenty seconds while somebody
 * is still reading. Absent must mean "use the default", never "use the minimum".
 */
export function clampIdleSeconds(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_IDLE_SECONDS;
  return Math.min(MAX_IDLE_SECONDS, Math.max(MIN_IDLE_SECONDS, Math.round(n)));
}
