// E20 shared gate helpers — small on purpose, imported by the volunteer
// routes and the /give page (route files may only export handlers/config in
// this Next version, so shared logic lives here).

/** The ship-dark flag (charter): unset/≠"1" means every volunteer surface —
 *  routes included — behaves as if it does not exist. */
export function volunteerSignupEnabled(): boolean {
  return process.env.VOLUNTEER_SIGNUP_ENABLED === "1";
}

/** The shift's Pacific calendar day. Date-only strings are taken literally —
 *  parsing them would anchor at UTC midnight, the PREVIOUS Pacific day
 *  (same rule and trap as volunteer-links.ts). */
const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

export function shiftPacificDay(dateIso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return null;
  return PACIFIC_DAY.format(new Date(t));
}
