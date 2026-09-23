# ADR-0008 — Paid race registration on Zeffy under the FR-A15 floor

**Status:** Accepted (Mat, 2026-09-16)
**Applies to:** the "Not Afraid of the Dark 5K" (7 Nov 2026) and any later paid Chamber event

## Context

The Chamber's first paid event needed online registration and a race-day roster. ROLLOFF-GROWTHZONE.md §0.3 had already ruled that paid ticketing, when wanted, deep-links out to an external provider under the FR-A15 floor ("zero payment code in the app"), naming Zeffy as a candidate pending its 501(c)(6) eligibility. GrowthZone is being cancelled (April 2027) and the Chamber's PayPal POS is card-present hardware, so neither carries new online registration.

## Decision

1. **Zeffy is the registration and payment system.** Eligible (any registered US nonprofit with an EIN and a bank account, 501(c)(6) named explicitly), free, per-ticket custom questions, e-tickets, a documented read API and HMAC-signed webhooks. The Chamber built the campaign itself; the app links out to it from `/race` with a plain link. No iframe — the CSP has no `frame-src`, and an embedded checkout would put payment UI on the Chamber's domain. *(Reversed by amendment 1, below.)*
2. **The roster is synced, not uploaded.** `src/lib/race/sync.ts` pulls succeeded payments for one campaign and upserts one row per ticket on `(payment_id, item_id)`. Every run is a full idempotent resync; the signed webhook only nudges it. "Sync now" in `/admin/race` is the authoritative path — the ADR-0002/ADR-0003 posture, manual-first with automation as an accelerator.
3. **Runner data kept is the minimum plus email:** name, email, ticket type, the mapped t-shirt answer, the mapped waiver answer (when the form asks), status, check-in time. Every other custom answer is dropped in code before storage. Bibs and timing belong to the timing company; the app assigns no bibs.
4. **A dedicated table, not the `record` store.** `writeRecord` snapshots whole documents into the immortal audit table; with email on the row that would copy a runner's email on every check-in tap. `race_registrant` mirrors `volunteer_signup`: ids-only audit rows, nullable PII columns, anonymized 45 days after race day.
5. **Check-in is admins plus one race-day link.** Volunteers use a signed, expiring link bound to `race_checkin_link.version`; minting or revoking bumps the version so every earlier link dies. The volunteer surface never carries email.

## Consequences

- The Zeffy API key is write-capable (no read-only key exists); it is `server-only`, never logged, and rotated from Zeffy's dashboard if it leaks.
- The webhook is per organisation and fires for every campaign; the receiver filters on `campaign_id`.
- Walk-ups on race day are recorded as offline payments in the Zeffy dashboard, never in the app — one source of truth.
- `race_registrant` is not yet in the backup bundle or the JSON export (the same gap `volunteer_signup` carries). Zeffy remains the source of truth and a resync rebuilds the roster; check-in state and the link version are the only app-only facts.
- A second edition of the race means a new campaign id, a new `race.id`, and either a truncate or a campaign column — deliberately not built now.

## Rejected

- **GrowthZone's ticketing module** — unused, on a subscription ending April 2027; new registrant data there would only enlarge the export sweep.
- **CSV upload instead of the API** — the owner chose the API sync; the CSV path remains the manual fallback via Zeffy's own exports.
- **Storing every answer** — an emergency-contact or medical field would turn the app into a second custodian of data Zeffy already holds.

## Amendment 1 — the form is embedded on `/race` (Mat, 2026-09-22)

Mat chose to keep registrants on the Chamber's page instead of sending them to zeffy.com. Decision 1's plain link becomes Zeffy's own embeddable form, in a frame on `/race`.

- **Click to load.** Zeffy's embed page loads Microsoft Clarity session recording, Amplitude, Google Tag Manager and ad cookies. The privacy page promises "no third-party analytics or ad tech", so the frame is created only when a visitor presses **Register now**; until then nothing from Zeffy loads, which is where the plain link left things. A notice says the form is Zeffy's and that Zeffy runs its own cookies, analytics and session recording; it stays on screen after the form opens. The plain link stays as "Or open the form on zeffy.com", above the frame so it is still reachable on a phone.
- **One header loosens, by one origin.** CSP gains `frame-src 'self' https://www.zeffy.com` — `'self'` restated because declaring `frame-src` replaces the `default-src` fallback, and Admin → Site content frames the site's own pages as a preview. Pinned by both security-header tests.
- **Payment stays off.** Permissions-Policy was briefly `payment=(self "https://www.zeffy.com")` for Apple Pay and Google Pay inside the frame (`self` is required — a page can only delegate a permission it holds; measured). Reverted to `payment=()` the same day: Zeffy does not display Apple Pay or Google Pay on embedded forms (its help centre, "Supported Payment methods"), and Mat dropped the wallet requirement.
- **The FR-A15 floor still holds.** The app renders no payment code and never sees card data: the checkout is Zeffy's document, in Zeffy's origin, under Zeffy's own CSP. What changes is that Zeffy's payment UI now sits inside the Chamber's page — the concern decision 1 recorded, now accepted.
- **One address, one campaign.** The embed address is derived from `registrationUrl` (`/ticketing/` becomes `/embed/ticketing/`), never configured on its own, so the frame and the link cannot drift onto two campaigns. Only an `https` ticketing address on `www.zeffy.com` is framed — the protocol is checked as well as the origin, since a `blob:` URL reports its creator's origin. Anything else falls back to the plain link, and the CSP would block it regardless.
- **No `sandbox` attribute.** Zeffy's checkout runs Stripe and 3-D Secure in the frame; a sandbox that broke either would only surface on a real purchase.
- The frame fits the screen (85% of the viewport, at least 560px) because Zeffy's form fills whatever height it is given and scrolls inside. Focus moves into it once, when it has loaded, with a loading line until then.
- The roster sync, the webhook and check-in are untouched.
- An outside review (Codex, 2026-09-22) raised the campaign drift, the `blob:` case, the notice vanishing after the click and the phone layout; all four are fixed as above. It also noted that Apple Pay and Google Pay inside the frame are only proven by a real purchase.

**Rejected:** Zeffy's pop-up button, which loads Zeffy's script into the Chamber's page — third-party code running in this origin, reachable to the DOM and cookies. An auto-loading frame, which would run Zeffy's trackers for every visitor to `/race`, including the ones who never register.

## Amendment 2 — three sync defects fixed (2026-09-22)

Found by the outside review of the close-out and by reading Zeffy's API spec; each reproduced before it was fixed.

- **An erased shirt answer came back.** Anonymization nulled it, the next sync wrote it back, and the row stayed marked anonymized, so the retention sweep never touched it again. The upsert now leaves the shirt answer null on an anonymized row.
- **A question that merely started with the shirt question's words was kept.** The match is now on the whole question text, and `race.ts` carries the live wording. Case, spacing and curly quotes are ignored; nothing else.
- **The $15 shirt became a runner.** Zeffy reports add-ons as ordinary `ticket` items — its only item types are donation, ticket and additional donation — and marks them only on the campaign's price list (`is_add_on`). The sync now reads that list once per run, counts add-ons on their order instead ("Order: 2 × ExploreKingston exclusive t-shirt", beside the sizing answer, Mat's choice), and deletes any add-on rows an earlier sync stored, with an ids-only audit row.

Decision 3's "the mapped t-shirt answer" now also carries the order's add-on count. No schema change.

## Amendment 3 — privacy notice 2026-10 (2026-09-22)

The public privacy page's short version said "no third-party analytics or ad tech" without exception. After a visitor presses Register now, Zeffy's cookies, analytics and session recording run inside the embedded form, so the page now names that exception and a new "Registering for the 5K" section says what loads when, and links Zeffy's own privacy policy. `PRIVACY_NOTICE_VERSION` is bumped to `2026-10` on Mat's decision, following the Chamber's precedent of bumping for a new outside party; the side effect is that visitors who allowed location are asked again.
