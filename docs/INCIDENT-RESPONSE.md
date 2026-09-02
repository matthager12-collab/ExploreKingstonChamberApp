# Incident response — suspected data breach (FR-A91)

A one-pager for the moment you suspect unauthorized access to app data. Work
top to bottom. When in doubt, treat it as real and contain first.

**Who:** the on-call operator (Mat) is primary; the **Chamber board designee**
is the backup contact (per the E10 alert-routing decision). Name and reach the
second person early — breach clocks are short.

## 1. Contain (do this now)

- **Rotate secrets.** Rotate `AUTH_SECRET` (invalidates all sessions), and the
  scoped machine tokens: `BACKUP_TOKEN`, `WORKLIST_SWEEP_TOKEN`,
  `RETENTION_TOKEN`, `EVENTS_INGEST_TOKEN`, `FERRY_OBSERVE_TOKEN`. Set new
  values in the Render dashboard (`render.yaml` lists them) and update the
  matching GitHub secrets + 1Password.
- **Revoke sessions.** Rotating `AUTH_SECRET` does this globally; for a single
  compromised account, disable it (bumps `sessionVersion`).
- **If the database may be exposed:** rotate the database credentials in the
  Render dashboard (`DATABASE_URL` is Blueprint-managed via `fromDatabase` —
  never paste it by hand), and rotate the `age` backup keypair if a bundle may
  have leaked (keep the old private key — old backups need it).

## 2. Assess scope

- The append-only `audit` table (`/admin/audit`) is the primary forensic record
  — who changed what, when. It cannot have been altered (insert-only trigger),
  so it is trustworthy even mid-incident.
- Determine **what data** and **how many Washington residents** are affected.
  The PII data map (`docs/PRIVACY.md` §1) is the checklist of what could be in
  scope.

## 3. Notify

- **Affected people:** notify without unreasonable delay and **no later than 30
  days** from discovery (RCW 19.255).
- **WA Attorney General:** required if **more than 500 Washington residents**
  are affected (RCW 19.255) — file the AG notice in that case.
- **MHMDA exposure:** assess whether any **consumer health data** was involved.
  By design the app collects none (no coordinates stored, no health-resource
  tracking), so this assessment should conclude "none" — but perform and record
  it, because MHMDA carries a private right of action.

## 4. Post-incident

- Complete the secret rotation from §1 if any was deferred.
- Record the incident, its scope, and the actions taken as an audit row / a note
  in `docs/OPERATIONS.md`.
- Review how it happened and close the gap.

**This is an operational runbook, not legal advice.** For any breach with real
exposure, involve the Chamber and, if warranted, counsel.
