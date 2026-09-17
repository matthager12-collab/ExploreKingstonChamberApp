# Runbook — 5K registration and race day (Zeffy)

The race sells tickets on Zeffy. The app shows the race page (`/race`), keeps a roster synced from Zeffy (`/admin/race`), prints the pickup sheet (`/race/print`) and runs check-in on volunteers' phones (`/checkin`). Decision record: `docs/adr/ADR-0008-race-registration-via-zeffy.md`.

## 1. One-time setup

**In Zeffy (organisation owner):**

1. Ticketing campaign → settings: **ask each attendee for name and email** (otherwise a family order lands as one buyer and three "guest" rows flagged for review). Make the t-shirt question a **per-ticket single-select** (free text cannot be tallied). Add a **waiver checkbox** per ticket if the Chamber wants waivers on file.
2. Settings → Integrations → **API**: generate a key. It can write as well as read — treat it like a password.
3. Settings → Integrations → **Webhook**: set the URL (staging first, see §4; production is `https://explore-kingston.onrender.com/api/webhooks/zeffy`), subscribe the `payment.*` events, copy the signing secret (`whsec_…`).
4. Note the campaign id (Campaigns → the campaign → the UUID in the URL, or `GET /api/v1/campaigns` with the key).

**On Render (both services):** set `ZEFFY_API_KEY`, `ZEFFY_WEBHOOK_SECRET`, `ZEFFY_CAMPAIGN_ID`. Until all three are set, `/admin/race` says "not connected", Sync now is disabled and the webhook answers 503 (fail-closed).

**In the app:**

- The race copy, dates, prices and the two question titles live in `src/lib/data/race.ts`. The question titles must match the **start** of the Zeffy question text (case-insensitive). An unmatched question is simply dropped.
- Admin → Site content → unhide **5K Fun Run** (`/race`). It ships dark.
- `/admin/events` → add the race with its link set to `/race`, so it appears on the calendar.
- Point the Chamber's short link (short.io) at `https://explore-kingston.onrender.com/race`. Printed material should carry the short link, not the Zeffy URL, so it can be re-pointed.

## 2. Keeping the roster current

- **Sync now** on `/admin/race` pulls every succeeded payment. Safe to press any time; a re-run changes nothing that has not changed on Zeffy.
- The webhook triggers the same resync a few seconds after each payment event. If it ever stops (Zeffy retries for three days, then gives up), Sync now catches up in one press.
- Names and emails are stored once per ticket and never rewritten by a later sync. A correction made in Zeffy after the first sync does not flow into the app; fix it in the app's database or leave it (Zeffy stays the record).
- **Needs a look** on the roster means one of two things: the ticket had no attendee details (ask at pickup who it is for), or the order was partially refunded (Zeffy shows which ticket).

## 3. Race day

1. On `/admin/race` → **Mint the race-day link**. Copy it — it is shown once. Send it to the pickup volunteers (text message is fine). It works until midday after race day; minting again replaces it and revoke kills it immediately.
2. Volunteers open the link on a phone. It lands on `/checkin`: search by name, tap **Check in**. A second tap undoes it. The screen shows name, ticket type, shirt answer and flags — never email.
3. **Walk-ups** paying on the Chamber's PayPal reader: record them in the **Zeffy dashboard as an offline payment** on the campaign (Payments → Add → cash/other, one ticket line each). The next sync (webhook or Sync now) puts them on the roster. Never register a walk-up in the app.
4. **Print** the pickup sheet from `/race/print` the night before as the paper fallback.
5. Refunds are done in Zeffy; the roster marks the ticket cancelled on the next sync and check-in refuses it.

## 4. Staging rehearsal (before the first real ticket relies on the webhook)

The Zeffy webhook is **one URL per organisation**. For the rehearsal:

1. Resume `explore-kingston-staging` on Render, set the three env vars there, point the Zeffy webhook at `https://<staging host>/api/webhooks/zeffy`.
2. Buy one test ticket (Zeffy lets the owner refund it). Watch the staging logs for the delivery; the registrant appears on staging's `/admin/race`.
3. Flip the webhook URL to production. Suspend staging again.

Until the flip, production relies on Sync now — which is fine.

## 5. After the race

- 45 days after race day the retention job (`npm run privacy:retention --apply` / the retention route) anonymizes every row: name, email and shirt answer are nulled; ticket type, status and check-in stay for counts. Before that date the job reports "not due".
- Revoke the race-day link if it has not expired.
- Consumer access/delete requests find registrants by email through the normal E11 workflow.
- A next edition: new campaign, new `race.id` in `race.ts`, and decide whether last year's anonymized rows stay (a campaign column) or go (truncate).

## 6. If something goes wrong

| Symptom | Check |
|---|---|
| Sync now answers "Zeffy answered 401" | The API key was regenerated in Zeffy — set the new one on Render |
| Sync now answers "Zeffy answered 429" | Rate limit (100/min per org). Wait a minute; the sync already backs off on its own |
| Webhook deliveries fail in Zeffy's log with 400 | The signing secret on Render does not match Zeffy's current one (it was regenerated) |
| Webhook deliveries fail with 503 | `ZEFFY_WEBHOOK_SECRET` is not set on that service |
| Every multi-ticket order shows "guest" rows | Per-attendee details are off on the campaign (§1 step 1) |
| Shirt column empty | The question title in `race.ts` no longer matches the Zeffy question |
| Volunteers see "That link doesn't work" | Expired, revoked, or replaced by a newer mint — send the current link |
