# Chamber research assistant

`/portal/assistant` lets Chamber admins submit a public link or plain-language request. An outbound CLI worker researches the request and returns sourced map entries, calendar events, and website/social copy. All public content changes require a portal review of the saved revision.

## Included

- Admin-only portal navigation, intake, status, revisions, map previews, draft editing, per-item publish/skip, copy-ready posts.
- Existing map icons include kayak, bicycle, playground and hiking/trailhead. Existing map views are reused.
- Durable Postgres queue, idempotent intake, expiring leases, bounded retries, worker timeout and cancellation. Closed pages and offline Macs do not lose requests.
- Source links and unanswered questions on every proposal. Questions block publication. Invalid coordinates, unknown map views/icons, invalid event times, duplicates and changed live records are rejected.
- Atomic publication plus existing record audit trail; existing admin history/restore remains the rollback path.
- Request backup/restore; in-flight jobs restore as queued without old bearer/lease credentials. Research requests join the PII access/delete inventory and respect legal holds.
- Worker uses direct HTTP API. MCP is not required for this version.

## Activation

1. Deploy this branch through the app's normal CI/review process. Boot migration creates `research_request`; it does not alter existing content.
2. Create a random `CHAMBER_RESEARCH_TOKEN` of at least 32 characters in the deployment's secret settings and the Mac's secret environment. Do not commit it. Restrict to this app; rotate by updating both ends. Do not paste it into chat or a terminal command history.
3. On the Mac with authenticated Claude Code, use Node 22+ and a CLI version supporting `--safe-mode`, `--json-schema`, and `--no-session-persistence` (check `claude --version` against current CLI documentation).
4. Set `CHAMBER_PORTAL_URL=https://app.explorekingstonwa.com` and supply the token through the local secret environment. Run `node scripts/chamber-research-worker.mjs --once` for one claim, or omit `--once` for continuous processing. For always-on operation, supervise this command with the Mac's service manager. No inbound port or SSH exposure is required.
5. Submit a small public-source test as an admin. Verify research finishes, source links open, preview is accurate, publish one approved item, then verify the public page and audit restore.

The CLI subprocess receives only an authentication/system environment allowlist, never the Chamber worker token. It runs in a temporary empty directory, with customizations disabled, only WebSearch/WebFetch built-ins, MCP tools denied, no session persistence, a 16-turn / $3 estimated budget, and a 15-minute timeout. Claude authentication continues to use the existing local installation; no account login is implemented here.

## Boundaries

- Post approval means approved copy, not external publication. CMS/social publishing credentials are not connected by this change.
- Private Google Drive files and sign-in-only social pages are not bypassed. Research explains missing access and requests pasted text or a public source. No file uploads or OCR in this slice.
- Map feature creation/update and calendar event creation/update are supported. Map-view renaming, arbitrary site code edits, and external CMS changes remain explicit follow-up work.
- Source links establish traceability, not a guarantee of factual correctness. Review dates, coordinates and claims before publication.
- A configured token is not a worker heartbeat. Queued jobs remain visibly waiting until a runner claims them. Interrupted jobs reclaim after 20 minutes, with up to three attempts; manual retry resets attempts.
- Research requests are private staff records. They may contain unintended personal data; the UI asks for public information and the PII inventory supports removal. No new automatic retention duration is introduced here.

## API contract

Portal (existing admin session, same-origin mutations):
- `GET /api/portal/assistant`: latest 100 requests, no lease tokens or baseline snapshots.
- `POST`: `{id: UUID, prompt, links: string[]}`. UUID reused on a transport retry.
- `PATCH`: `{id, revision, action: retry|cancel|edit|dismiss|publish, ...}`. Draft actions include `draftId`; edit includes `proposal`; retry accepts feedback. Stale revisions return 409.

Worker (header `Authorization: Bearer …`, no cookies):
- `POST /api/assistant-worker {action:"claim"}` returns one leased job and map/event context.
- `{action:"complete",id,leaseToken,result:{summary,drafts}}` or `{action:"fail",id,leaseToken}`.
- There is intentionally no worker publication operation. A stale lease cannot finish or fail a newer attempt.

## Verification

Tests cover persistence, idempotency, lease expiry/reclaim/cancellation, atomic publication, stale review protection, stale live-content protection from the pre-research snapshot, duplicate rejection, geography validation, unresolved-question holds, copy-only post approval, backup token exclusion, PII removal, route authorization, cross-origin writes, and worker tool restrictions. Live CLI/provider execution and deployment activation require the configured host and credentials.
