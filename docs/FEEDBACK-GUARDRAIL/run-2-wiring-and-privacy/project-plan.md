# Run 2: Wiring and privacy

Phases 2, 3 and 4 of [../plan.md](../plan.md), tasks T-05 – T-19.

## Goal

Wire `moderateComment` into the intake path, add optional contact capture to the
widget, promote `feedback_response` to a full `PiiStore`, and release.

## Why this is one run and not three

`src/lib/privacy/pii-inventory.test.ts` fails by design from T-05 until T-15 (DEC-002).
A boundary inside that window could not have a mechanically-checkable green exit — it
would have to assert "red in exactly one expected way", which is a hope, not a check.
See [../split-assessment.md](../split-assessment.md).

## Isolation

Shared checkout, after run 1 has merged. Re-read before editing and stage explicitly —
another session may be in the same tree.

## Entry criteria

| Criterion | Check |
|---|---|
| Run 1's exit criteria still hold | `./docs/FEEDBACK-GUARDRAIL/run-1-sealed-seam/validate-exit.sh` prints `ALL CHECKS PASSED` |
| `moderateComment` is importable | `src/lib/feedback-moderation.ts` exports it |
| The T-01 finding is recorded | [../design.md](../design.md) § Contracts names the mechanism in use, with no implementation-order note left standing |

## Tasks

### Phase 2 — intake, widget, admin

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-05 | Optional `name`, `email`, `moderated` on `FeedbackResponse`; rewrite the "NO contact field, by design" block at `src/lib/types.ts:271` | entry | `npm run typecheck` exits 0. Rows without the new fields still satisfy the type. The stale instruction forbidding an email field is **deleted**, not contradicted. |
| T-06 | `src/app/api/feedback/route.ts`: validate `name`/`email`; call `moderateComment` after the idempotency claim and before the save; return `{ok, moderated}`; rewrite the header comment | T-05 | Malformed email dropped, submission still 200s. Duplicate key returns `{ok,duplicate,moderated:false}` with **zero** model calls. A rude comment stores `cleaned` with `moderated:true`, and the original appears in no row, log line or Sentry breadcrumb. |
| T-07 | `src/lib/outbox.ts`: `submitOrQueue` returns `body?: unknown` on the `sent` branch | entry | Existing outbox tests pass **unedited**. A non-JSON response yields `body: undefined`, not a throw. The contract block at line 192 documents it as the `httpStatus` addition is documented. |
| T-08 | Copy registry: reword `feedback.panel.intro`; add `feedback.name.label`, `feedback.email.label`, `feedback.contact.hint`, `feedback.thankyou.moderated` | T-05 | The intro no longer tells visitors to omit contact details. All four keys render on `/admin/content`. The moderated wording matches [../plan.md](../plan.md) § Agreed copy. |
| T-09 | `src/components/feedback-tab.tsx`: optional Name and Email inputs; branch the done-state on `body.moderated`; rewrite the PRIVACY header comment | T-07, T-08 | Both inputs labelled, `autoComplete`-hinted, meeting the panel's 44px target rule. Submit enabled with both blank. |
| T-10 | `src/app/(site)/admin/feedback/comment-list.tsx`: a "rewritten" marker on `moderated` rows | T-05 | Text, not a glyph alone; announced by a screen reader. Unflagged rows visually unchanged. |
| T-11 | Extend `src/app/api/__tests__/feedback-route.test.ts` | T-06 | Contact validation, malformed-email-dropped, `moderated` persisted, replay-makes-no-model-call. |

### Phase 3 — privacy promotion

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-12 | `src/lib/db/append.ts`: `findFeedbackByEmail`, `deleteFeedbackByEmail`, case-insensitive on `response->>'email'` | T-11 | Parameterised SQL only. A caller-supplied `%` or `_` matches literally, not as a wildcard. `deleteFeedbackByEmail` returns the row count. |
| T-13 | `src/lib/privacy/pii-inventory.ts`: replace the `noIdentifierStore` entry with a real `PiiStore` | T-12 | `hasEmailIdentifier: true`. Hard delete, matching `deleteFeedbackResponsesBefore`. The export `note` states both halves: email-carrying rows are findable, rows without one remain findable only by their wording (DEC-005). |
| T-14 | `docs/PRIVACY.md` (line 26, lines 35–55) and `src/app/(site)/privacy/page.tsx` (lines 46, 155) | T-13 | Both name Anthropic as a processor of comment text. Both state the email is optional, unverified, and requests are reviewed by a person. Neither still claims the route drops contact-shaped fields. |
| T-15 | Bump `PRIVACY_NOTICE_VERSION` to `"2026-09"`; prepend a changelog entry | T-14 | `src/lib/privacy/policy.test.ts` passes, including its changelog-head assertion. |

### Phase 4 — release

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| T-16 | Set `ANTHROPIC_API_KEY` on the Render service | T-15 | Set in the Render dashboard only. In no commit, note, or message. |
| T-17 | **Ask** the Chamber, **before deploy**, whether they accept the notice bump re-prompting every returning visitor | — | Their answer recorded in writing. This is their call per `policy.ts:18-21` and has gone the other way before; a decline reopens DEC-007. |
| T-18 | Squash-merge to `main`; one-line entry at the top of `engagement/activity.md` | T-16, T-17 | Branch deleted after merge. |
| T-19 | Watch `/admin/feedback` for two weeks | T-18 | The proportion of rows marked "rewritten" is checked against expectation. Sustained over-firing reopens the rewrite instruction from T-03. |

## Exit criteria

Checked by [`validate-exit.sh`](./validate-exit.sh). Run it from `work/`.

1. The whole gate — typecheck, lint, boundaries, both suites — exits 0 **with no
   exceptions**. The tripwire is satisfied.
2. `PRIVACY_NOTICE_VERSION` reads `"2026-09"`.
3. Anthropic is named in both `docs/PRIVACY.md` and the public privacy page.
4. No stale "no contact field" / "drops any contact" claim survives anywhere.
5. `npm run build` exits 0.
6. No API key in the diff.

T-17 and T-19 are not script-checkable. They are listed in
[../choreography.md](../choreography.md) § Handoff protocol as human gates.

## The red-suite window

From T-05 to T-15 the PII coverage test fails on purpose. **Do not merge to `main`
inside it, and do not "fix" the test** — it is enforcing the privacy work. Any *other*
failing test in that window is a real regression and stops the run.
