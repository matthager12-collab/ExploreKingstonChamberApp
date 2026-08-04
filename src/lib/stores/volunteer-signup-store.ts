// E20 — app-facing delegate for the volunteer-signup store. The
// implementation lives in src/lib/db/volunteer-signups.ts because drizzle
// handles are db-layer-only (dependency-cruiser: db-client-only-via-db-layer);
// this module is the import surface routes and components use, matching the
// json-store delegate precedent (E05).

export {
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
  type CancelResult,
  type CheckInResult,
  type SignupResult,
  type SignupRow,
} from "@/lib/db/volunteer-signups";
