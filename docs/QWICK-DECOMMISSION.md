# Qwick Tourist kiosk — decommission checklist (E17)

Operator-facing checklist for retiring the Qwick Tourist kiosk software and
its $816 CAD/yr licence. Work through it top to bottom; every box is a human
step — nothing here is automated.

> **STATUS 2026-08-01 — the vendor's backend is DEAD, so this decommission is
> now involuntary and already in progress.** Both vendor hostnames stopped
> resolving (`node.qwickmedia.com` — the GraphQL API — and
> `cms.qwicktourist.com` — the CMS the kiosk browser renders; their Heroku
> DNS targets return nothing, and `qwickmedia.com` itself decays to a
> WordPress-signup placeholder). Consequences:
>
> 1. **The physical kiosk is almost certainly showing an error screen.**
>    Check it; if so, repoint it at the app's own kiosk build (see
>    `## After`) — the E22 `/kiosk` client is already deployed.
> 2. **The planned "final data escape" can no longer run against the API.**
>    The 166-listing export pulled 2026-07-03/04 was not retained; recovery
>    options are in `## Data escape` below.
> 3. **Do not pay any renewal invoice** without written confirmation the
>    service is actually restored (see `## Licence & renewal`).

## Licence & renewal

Pricing facts (vendor renewal modal, CAD): **$816/yr** billed annually
($68/mo) · $222/qtr ($74/mo) · $81/mo monthly. No contract, no auto-renewal.

- [ ] `Renewal date: ____` (CONFIRM against the `cms.qwicktourist.com`
      billing page **if it ever resolves again** — the dashboard's
      "Expired, Please renew" banner and the API's `License.status: VALID`
      were already known to disagree before the outage).
- [ ] With the backend dead (verified 2026-08-01), the working assumption is
      that there is nothing left to renew. **Pay nothing** unless the vendor
      restores service AND the Chamber decides it still wants it (it should
      not — see `## After`).
- [ ] Calendar reminder: if any invoice or auto-charge appears, dispute it —
      the service was unavailable. Name the front desk AND the second
      contact from the ops alert-routing runbook.

## Decision gate at renewal

The original three options if E22 was not live by renewal — renew annually
($816), bridge monthly ($81/mo), or run the kiosk dark — have collapsed:
**E22 is live in production and the vendor is gone.** The only decision left
is when to physically repoint the kiosk PC (see `## After`). No money goes
to Qwick under any branch.

## Data escape (before cancelling — data-loss deadline)

The deadline arrived early: the API died before the final pull. What exists
and how to recover the rest:

- [x] The importer, precedence policy, and `--fixture` path are built and
      tested (`npm run import:qwick -- --fixture <export.json>`), so ANY
      recovered export imports safely — dedupe/precedence rules protect the
      curated listings automatically.
- [ ] **Recovery option 1 — the kiosk PC's browser cache.** The locked-down
      browser rendered the listings daily; its HTTP cache / localStorage may
      hold the last-good data (the CMS was an Apollo GraphQL client — a
      persisted cache would be JSON). Reboot exposes the desktop briefly;
      copy the browser profile directory to a USB stick BEFORE letting
      anyone "fix" the error screen by clearing data.
- [ ] **Recovery option 2 — Mat's Chrome (Browser 1).** The
      `cms.qwicktourist.com` console was used from it in July; check
      DevTools → Application → Local Storage / IndexedDB for that origin.
- [ ] **Recovery option 3 — ask other chambers/DMOs on Qwick** whether they
      kept exports or have vendor contact that still answers (the July probe
      showed the API leaked cross-tenant data, so the vendor may yet
      resurface somewhere).
- [ ] Whatever is recovered: run the import (dry-run first), archive the raw
      export JSON into the encrypted off-site backup, and note the recovery
      provenance in the import PR.
- [ ] If nothing is recovered: the directory seeds from the curated
      listings (~34 records) plus new-member submissions (E30) rebuild
      coverage organically; record the loss here and move on.

## Hardware

- [ ] Confirm hardware ownership: locate the purchase invoice (the vendor's
      "when you purchase your kiosk" language says the Chamber owns it).
- [ ] Get OS admin on the kiosk PC (it is a normal PC — reboot exposes the
      desktop and a ~30s settings window). Do the **data recovery first**
      (see above) before any cleanup.
- [ ] Record the display's measured wattage and nit rating — feeds the E22
      hardware/power decision per `docs/KIOSK-POWER.md` §5.

## Cancellation

- [ ] Cancel in the `cms.qwicktourist.com` console **if it ever resolves**;
      otherwise document (screenshot the DNS failures) that the service
      ended unilaterally — that record is the Chamber's defence against any
      later invoice.
- [ ] Confirm no further charges on whatever card the licence was billed to.
- [ ] Mark the Qwick licence line retired in the cost-attribution ledger
      when E18 lands (chamber-ops line, never LTAC).
- [ ] Keep any recovered export in backups permanently.

## After

- [ ] Repoint the kiosk PC's browser at the app's own kiosk build — the E22
      `/kiosk` client is **already live in production** (see
      `docs/KIOSK-DEPLOY.md`). This turns the vendor's failure into the
      planned end-state, just earlier.
- [ ] Mark the Qwick source retired in `docs/DATA_SOURCES.md` (§13 already
      records the outage).
- [ ] The importer code stays in the tree (harmless, fixture-tested) as the
      recovery path and provenance record.
