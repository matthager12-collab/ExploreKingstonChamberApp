# Late registration — 2026-10-19

## Brief
Mat needs a link Jen can give late entrants. Reuse the existing form and anonymous pending-moderation path. Original registration explicitly closes on October 17 to fix the trail/ballot; preserve that rule and introduce a deliberate late-entry exception bounded to the advertised crawl dates. No production test data, outbound messages, services, credentials or cost changes.

## Plan and focused specification
1. Keep normal registration closed. Add a separate /scarecrow/register page and /api/scarecrow/register/late endpoint, sharing the original handler and rate-limit bucket.
2. Late requests accepted only from 2026-10-17 00:00 Pacific through before 2026-10-31 17:00 Pacific. Voting override cannot reopen registration. Hidden crawl refuses all registrations.
3. Reuse all field/length/body/coordinate/honeypot checks and server-generated IDs. Every entry remains pending; contacts remain private. Repeated submissions intentionally become distinct pending records for Chamber review, never overwrite existing entries; shared five/hour limit still applies.
4. Reuse existing form with a bounded late-mode prop. Show approval and closing time clearly; closed state has no form. No map/vote changes.
5. Verify ordinary and late route date boundaries, invalid bodies/fields/coordinates, honeypot, shared throttle, repeat IDs, pending public exclusion and admin approval against synthetic in-memory PGlite fixtures. Run targeted tests, typecheck, lint/boundaries and build where feasible.

## Ownership and authority
Isolated feature worktree from origin/main f4b15d7. Existing engagement checkout is ferry WIP and preserved. App thread inventory showed no other active Chamber owner; latest local Chamber Claude trace dated October 13. Process inventory unavailable (sandbox ps denied), so no exclusive-owner claim. Parent early-update tool returned thread not found; final delegated report remains the coordination channel.
Application-security v1.2 loaded. Engineering constitution approved R2 and local approved-wording R3 snapshot examined; R3 activation is explicitly pending. Implementation and verification are distinct from release acceptance. Parent must arrange independent candidate/browser verification before release.

## Release and rollback
No release authorized: infra/ws/publishing.txt lists Chamber, main auto-deploys production, and agent-team operating contract preserves Mat go for Chamber merges/deploys. Request approval only for this candidate after verification, never reopen unbounded normal registration. No production POSTs. After approved deployment, read back /scarecrow/register and crawl/map/vote pages without creating entries; verify deployed commit and health. Until then URL is proposed, not usable delivery.
Rollback: revert candidate commit and deploy through same approved release path; no migrations or data deletions. Existing held entries remain pending and Chamber-managed. Verify health, crawl and original cutoff after rollback.

## Evidence
Implemented page and endpoint using original handler/form; normal cutoff unchanged. RED: before implementation, late October 19 submission returned 403 instead of expected 200 and late pre-start date returned 200 instead of expected 403. GREEN: full unit suite 216 files, 2,665 passed, six existing skips; subsequent exact late-route and visibility rerun 22 passed. UI render/error tests three passed. Typecheck, focused ESLint and full lint (zero errors, 94 warnings), dependency boundaries, diff whitespace check and Next 16.2.11 production build passed. Build includes dynamic /scarecrow/register and /api/scarecrow/register/late; build reported 11 existing-style NFT tracing warnings involving next.config/media-store. No runtime production POSTs, production DB access, messages or deployment.

Initial typecheck using old shared node_modules failed on missing pdf-lib. Replaced only the new worktree symlink with its own npm ci --ignore-scripts install from unchanged lockfile; typecheck then passed. Node v24.19.0, npm 11.17.0. No dependency or lockfile changes.

Security controls exercised: original cutoff/query bypass, late start/end/year bounds, pending-only status despite client-supplied live status/ID/views/link, private contact exclusion from feature, admin approval flow, unique IDs for repeats, hidden page denial, five/hour shared throttle, malformed/oversized/out-of-area/missing/long input, honeypot, escaped script/event-handler/URL-shaped error canaries. No authorization, SQL, map, voting or storage implementation changed.

SECURITY: FAIL for release clearance. New boundary negative tests pass and final diff has no identified new Critical/High finding. However npm audit --omit=dev reports ten inherited production dependency advisories: two critical, seven high, one moderate, including direct next and maplibre-gl. These are scanner claims, not a verified exploitability determination; no unrelated dependency upgrades attempted. Existing package-lock is unchanged. Parent must triage relevant advisories and obtain required independent exact-candidate verification before release; this worker cannot self-certify an exception.

Server/browser suite not run: no TEST_DATABASE_URL supplied. Its setup explicitly wipes its target, so production DATABASE_URL was never loaded or substituted. Component/page render tests and synthetic in-memory migrated PGlite integration tests are development evidence, not actual deployed browser readback. Build success is not deployment proof. Full observable tool trace retained by platform; no claim of independent final acceptance, complete cross-provider trace capture or Maludb capture.

Loaded skill: application-security v1.2, SHA-256 e18c2153ca317d117f8fff554894d1efdbc61d0c163cf1e6b7e7390e053e8252; implement-spec workflow read, SHA-256 f73c56d4626260ceccd9938f4fe26dde446b09f9ad65b6e382742f2015d2d570. The explicit delegated implementation instruction provides scoped change authority; it does not provide release approval. Next bundled route-handler documentation read before editing.

Candidate acceptance proposal: independently inspect this commit, browser-check the built page with disposable data, triage inherited audit results, then seek Mat go specifically to merge/deploy this bounded 2026 exception. After deploy confirm exact revision, HTTP 200 and usable form at /scarecrow/register, /api/health, existing crawl/map/vote rendering and warm /line per DEPLOY.md. Do not submit production fixtures.
