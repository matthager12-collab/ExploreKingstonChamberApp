# Alerts & on-call

**Purpose (bus factor).** When something breaks, *someone's phone must ring* —
and it must not be only one person's. This runbook inventories every alert
source and names who acts when the primary maintainer is unavailable.

---

## Alert sources — what fires, and where it lands

| Source | Watches | Where it lands | Who sees it |
|--------|---------|----------------|-------------|
| **UptimeRobot** | `GET /api/health` (external poll) | email / SMS to alert contacts | Primary + **secondary** (add below) |
| **Render** | deploy success/failure, health-check flaps | Render dashboard + notification email | Primary (+ secondary if granted access) |
| **Sentry** | server errors / new issues | Sentry email alerts | Primary |
| **Off-site backup job** | nightly `backup-offsite.yml` run | GitHub Actions run status (red ✗ = backup did **not** happen) | Primary (watch the Actions tab) |
| **`/admin/ops` quiet signals** | cron staleness, backup age, GeoLite2 age | only visible when someone opens the page | whoever looks |

The `/admin/ops` page is the human-readable rollup of the quiet signals — the
ones nothing pushes to a phone. Someone should glance at it weekly.

---

## Contacts

**Primary contact: Mat** (maintainer). First responder for everything above.

**Secondary contact: the Chamber board designee.** Fill this in and keep it
current — this is the whole point of the runbook:

- Name: **Jen Skalbeck** (Chamber board)
- Phone: `____________________`
- Email: `____________________`
- Date confirmed: `____________________`

To make the secondary contact real (do all three):

1. Add them as an **UptimeRobot alert contact** (so `/api/health` down pages
   their phone, not just Mat's).
2. Grant them **Render dashboard access** (or, at minimum, set up a documented
   email-forward of Render notifications to them).
3. Walk them through the **Escalation ladder** below once, so the first time they
   use it isn't during a real outage.

---

## Escalation ladder

If the **site is down > 30 minutes and the primary contact is unreachable**, the
board designee does, in order:

1. **Confirm it's really down:** open <https://explore-kingston.onrender.com/api/health>.
   Not 200 (or no response) = down. 200 with `"ok": true` = the site is up; the
   problem is elsewhere (stop here, note it).
2. **Check Render:** the Render status page (<https://status.render.com>) and the
   service's **Events** tab. A bad deploy shows here.
3. **Roll back** (usually fixes a bad deploy): in the Render dashboard, redeploy
   the **previous** successful commit — see `docs/OPERATIONS.md` §3 for the exact
   click-path. This is the safest first action and is almost always the fix.
4. **If data looks wrong** (not just down): follow
   [`RESTORE-DRILL.md`](./RESTORE-DRILL.md) — but a data restore is a bigger step;
   prefer waiting for Mat unless data loss is actively ongoing.

Do **not** rotate secrets, change `DATABASE_URL`, or delete anything during an
outage — those are how a bad hour becomes a bad week.

---

## Quarterly re-verification

Every quarter (with the restore drill): **confirm the board designee's contact
info is current, and send a test alert to verify it actually reaches them.** An
alert contact you have never tested is the same as no contact at all.
