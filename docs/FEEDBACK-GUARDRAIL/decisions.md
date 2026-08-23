# Decisions: Feedback rudeness guardrail

| # | Question | Status | Decision | Round |
|---|---|---|---|---|
| DEC-001 | One model or two? | Decided | A — Claude Haiku 4.5 only | R1 |
| DEC-002 | How far does the privacy work go? | Decided | A — full `PiiStore` promotion | R1 |
| DEC-003 | What does the admin page see? | Decided | A — cleaned text only, plus a flag | R1 |
| DEC-004 | Where does moderation run? | Decided | A — inline in the POST path | R1 |
| DEC-005 | Is an unverified email a valid privacy key? | Decided | A — accepted, admin-mediated | R1 |
| DEC-006 | Fail open or fail closed? | Decided | A — fail open | R2 |
| DEC-007 | Bump `PRIVACY_NOTICE_VERSION`? | Decided | A — bump to `2026-09`; Chamber approved 2026-08-23 | R2 |

---

## Round 1

### DEC-001: One model or two?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: The original request named "Haiku and GPT 5.6 Luna". That second model ID
could not be verified — it is not a model I have on file, and there is no OpenAI SDK
anywhere in this repo. Writing an integration against an API shape I cannot confirm
would produce code that compiles and does not work.

| Option | Description | Trade-offs |
|---|---|---|
| A | Claude Haiku 4.5 only | One secret, one bill, one failure mode. Cheapest tier available at $1/$5 per MTok. No second opinion on a borderline comment. |
| B | Haiku primary, GPT as fallback on error | Survives an Anthropic outage. Doubles the secrets and the vendor-disclosure surface on the privacy notice, for a path that runs rarely and is hard to test. |
| C | Both every time, flag on agreement | Fewer false positives. Doubles cost and latency on every commented submission, and both providers then appear in the notice as processors of visitor free text. |

**Recommendation**: A — the second model ID cannot be verified, and adding a second
processor of visitor free text to a privacy notice is a real cost for a guardrail that
already fails open.

**Decision**: A. A second provider can be added later behind the `moderateComment`
signature without touching the route, the widget, or the store.

**Consequences**: The guardrail is unavailable whenever the Anthropic API is — which,
under DEC-006, means rude comments store unmoderated during an outage. Only one vendor
must be disclosed on the privacy notice. `moderateComment` returning a discriminated
union rather than a raw model response is what keeps option B cheap later.

**Applied to**:
- [design.md](./design.md) § Approach, § Contracts
- [plan.md](./plan.md) § Phase 1

---

### DEC-002: How far does the privacy work go?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: `feedback_response` is registered via `noIdentifierStore(…)` in
`src/lib/privacy/pii-inventory.ts:298`. `src/lib/types.ts:277` explicitly forbids adding
an email field without giving the store real find/export/delete handlers, and
`docs/PRIVACY.md` and the public notice both state the store holds no identifier.
Adding a contact field without the handlers would make the app's own privacy page
false.

| Option | Description | Trade-offs |
|---|---|---|
| A | Full `PiiStore` promotion — find, export, delete by email | The app's GDPR/CCPA machinery stays honest and the coverage test keeps working. Roughly half the total effort: two DB helpers, a registry entry, notice copy, and a version bump. |
| B | Add the fields, defer the privacy work as tracked debt | Ships the visible feature in a fraction of the time. The published privacy notice would state something untrue for as long as the debt stands. |
| C | No contact fields at all | Zero privacy work. Loses the ability to reply to anyone, which was half the request. |

**Recommendation**: A — B publishes a false claim on a page whose whole purpose is
being true, and the codebase left a written instruction anticipating exactly this
change.

**Decision**: A.

**Consequences**: Phase 3 is as large as Phases 1 and 2 together, and cannot be
deferred or shipped separately — the coverage test fails the moment the identifier
lands, so the feature and its privacy work are one atomic release. Historic rows with
no email stay unfindable, which the export note must say plainly rather than implying
the whole store became searchable.

**Applied to**:
- [design.md](./design.md) § Contracts
- [plan.md](./plan.md) § Phase 3
- [verification.md](./verification.md) § Phase 3 exit

---

### DEC-003: What does the admin page see?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: When a comment is rewritten, there is a choice about whether the original
abusive text is kept. `feedback_response` already carries the shortest retention window
of any store in the app (12 months) precisely because free text is the risky part.

| Option | Description | Trade-offs |
|---|---|---|
| A | Cleaned text only, plus a `moderated` flag | Nobody at the Chamber has to read the abuse, and there is no stored abuse to leak or subpoena. The flag keeps over-firing visible. Irreversible — a bad rewrite cannot be checked against the original. |
| B | Store both, original collapsed behind a toggle | A rewrite that loses meaning can be recovered. Stores abuse in a system of record, and puts it in the vendor-exit export and the nightly backup. |
| C | Cleaned only, no flag | Simplest data model. Nobody could ever tell whether the classifier was over-firing, including during the first month when that is the main risk. |

**Recommendation**: A — the flag is what makes the classifier auditable, and C removes
the only signal that would catch a bad prompt.

**Decision**: A.

**Consequences**: A rewrite that drops substance is unrecoverable; the visitor's
original words are gone. This raises the stakes on the rewrite instruction, which must
prioritise preserving the substantive complaint over brevity. It also means the
admin-facing "rewritten" marker is not decoration — it is the only over-firing signal
the design has, so it cannot be dropped as polish.

**Applied to**:
- [design.md](./design.md) § Key flows, § Contracts
- [plan.md](./plan.md) § Phase 2, Task T-09

---

### DEC-004: Where does moderation run?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: The visitor-facing message is the point of the feature — a rude submitter
should be told their words were rewritten and why. That message can only be delivered
if the classification result exists before the HTTP response is sent.

| Option | Description | Trade-offs |
|---|---|---|
| A | Inline in the POST route, between the idempotency claim and the save | The visitor gets the tailored reply. The original never reaches Postgres. Adds model latency (bounded at 4s) to submissions that carry a comment. |
| B | Save first, moderate asynchronously, patch the row | Submit stays fast. Writes the original to Postgres before moderation, contradicting DEC-003, and the response has already gone so the visitor can never be shown the reply. Needs a job runner the Render service does not have. |
| C | Local wordlist gate, escalating to Haiku only on a hit | Near-zero cost. A wordlist catches profanity and nothing else — not contempt, sarcasm, or condescension, which is what "even slightly rude" means. The wordlist becomes the de facto policy. |

**Recommendation**: A — B forecloses the feature's entire purpose, and C cannot meet
the stated bar.

**Decision**: A.

**Consequences**: `/api/feedback` gains an external network dependency in its request
path, so it inherits the route's existing "never fail the visitor over telemetry" rule
— which is what forces DEC-006. Submissions carrying a comment get slower by up to 4s;
rating-only submissions are unaffected because the model is not called at all. Placing
the call *after* the idempotency claim means a replayed offline submission costs
nothing.

**Applied to**:
- [design.md](./design.md) § Structure, § Key flows
- [plan.md](./plan.md) § Phase 2, Task T-06

---

### DEC-005: Is an unverified email a valid privacy lookup key?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: The email field is optional and typed by an anonymous visitor with no
confirmation step. Under DEC-002 that same address becomes the key the access and
deletion workflow searches by. Anyone can type someone else's address.

| Option | Description | Trade-offs |
|---|---|---|
| A | Store as typed; the admin-operated fulfilment flow reviews matches before acting | Matches how feedback deletion already works — `docs/PRIVACY.md` describes it as a manual admin step. No new infrastructure. A deletion request could match a row the requester did not write, if someone typed their address. |
| B | Capture the email for replies but keep the store identifier-free | Far less work. The app would hold contact data it claims not to index — a weaker position than today, and one the coverage test would not catch. |
| C | Confirmation email before the address counts as an identifier | Strongest guarantee. Adds an email round-trip, a pending state, and a token store to a one-shot anonymous widget, for a field most visitors will leave blank. |

**Recommendation**: A — the fulfilment path is already human-reviewed, so the residual
risk is a false match an admin can see and reject, not an automated wrongful deletion.

**Decision**: A, with the limitation stated plainly in the public notice rather than
glossed.

**Consequences**: The privacy notice must say the address is unverified and that a
request is reviewed by a person, not fulfilled automatically. Rows submitted without an
email remain findable only by their wording, so the store is *partially* searchable —
the export note must say both halves. If the Chamber later wants automated fulfilment,
DEC-005 is what has to be revisited first.

**Applied to**:
- [design.md](./design.md) § Contracts
- [plan.md](./plan.md) § Phase 3, Tasks T-11 and T-13

---

## Round 2

Opened by applying round 1: DEC-004 put an external dependency in the request path,
which forces a failure-mode decision; DEC-002 and DEC-005 both change the published
notice, which forces a versioning decision.

### DEC-006: Fail open or fail closed?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: DEC-004 places an Anthropic API call inside the visitor's request. The
route today treats storage failure as non-fatal — it logs and still answers `{ok:true}`,
because a telemetry outage must not cost a visitor their submission. The new dependency
needs the same question answered explicitly.

| Option | Description | Trade-offs |
|---|---|---|
| A | Fail open — store the comment as written, show the ordinary thank-you | No feedback is ever lost, and no visitor is falsely told their words were rewritten. Rude comments store unmoderated during an outage, so the Chamber may read one. |
| B | Fail closed — reject the submission when moderation is unavailable | The Chamber never sees unmoderated abuse. An Anthropic outage takes the whole feedback feature down, and the outbox deletes its copy on a 4xx, so the visitor's words are lost permanently. |
| C | Fail open, but hold unmoderated comments in a quarantine state | Neither loses feedback nor exposes the Chamber. Adds a review state, an admin surface, and a second lifecycle to a store designed to be append-only. |

**Recommendation**: A — B converts a vendor outage into permanent data loss for the
visitor, which is a strictly worse outcome than an admin reading an occasional rude
comment. C is a disproportionate amount of machinery for a rare case.

**Decision**: A.

**Consequences**: The guardrail is best-effort by design and must be described that way
to the Chamber — it is not a filter they can rely on absolutely. `moderateComment` can
therefore never throw, which is why it returns `{ checked: false }` rather than
rejecting, and why every failure-mode branch needs its own test. Silence is
indistinguishable from "not rude" in the stored row, which is a further argument for
the `moderated` flag from DEC-003.

**Applied to**:
- [design.md](./design.md) § Containment controls (C8), § Key flows
- [plan.md](./plan.md) § Phase 1, Task T-03
- [verification.md](./verification.md) § Phase 1 exit

---

### DEC-007: Bump `PRIVACY_NOTICE_VERSION`?

**Date**: 2026-08-21
**Decided by**: Mat
**Status**: Decided

**Context**: `PRIVACY_NOTICE_VERSION` is `"2026-08"` (`src/lib/privacy/policy.ts:29`).
Consent is version-gated against it, so a bump re-prompts every returning visitor for
consent. This change adds optional contact fields to a store previously advertised as
identifier-free, and introduces Anthropic as a new processor of visitor free text.

| Option | Description | Trade-offs |
|---|---|---|
| A | Bump to `2026-09` with a changelog entry | Consent is re-obtained against an accurate notice, which is what the version gate exists for. Every returning visitor sees the consent prompt again, which will show up as a dip in the analytics consent rate. |
| B | Update the notice text without bumping | No re-prompt, no visible disruption. Visitors would be operating under consent granted to a notice that did not mention a new processor or a new identifier. |

**Precedent, found 2026-08-21 while re-verifying citations.** `policy.ts:18-21` records
the *opposite* call being made once already, when the feedback widget itself shipped:

> NOTE: this added a data category to the published schedule without bumping
> `PRIVACY_NOTICE_VERSION`, because that bump re-prompts every version-gated consent
> (the geo card). **Whether the Chamber wants that prompt is their call, not a side
> effect of shipping a widget.**

That note does not change the recommendation — adding a *processor* and an *identifier*
is a materially larger change than adding a retention row — but it does establish that
this call belongs to the Chamber and has previously gone the other way.

**Recommendation**: A — a new external processor of free text and a new personal-data
field is precisely the material change the gate was built to catch.

**Decision**: A, with T-17 upgraded from *tell* to **ask**: the precedent above makes
the prompt the Chamber's decision, so Phase 4 seeks their agreement before deploy
rather than merely warning them. If they decline, DEC-007 is reopened, not overridden
in passing.

**Chamber's answer — approved, 2026-08-23.** Reported by Mat. T-17's question is
therefore settled ahead of Phase 4 rather than during it: the Chamber accepts that
bumping the notice re-prompts every returning visitor for consent. DEC-007 stays
`Decided` and does not reopen.

**Reviewed with the Chamber in person, 2026-08-23**, sitting with Mat. So the approval
is a considered one rather than a forwarded yes.

What that review could and could not have covered, stated plainly because the
distinction matters later:

- **It covered this plan.** The documents in `docs/FEEDBACK-GUARDRAIL/` existed on that
  date and were on screen.
- **It cannot have covered the T-14 notice copy**, which does not exist yet — no
  application code has been written. That copy still needs the Chamber's sign-off when
  it is drafted, and this entry is not it.
- **The approval predates the deploy by some margin.** If Phase 4 slips well past
  2026-08-23, re-confirm rather than relying on this line.

**Open, not done: attach the Chamber's written approval to the engagement record.**
This entry is a second-hand note of an in-person conversation, not the record itself,
and an in-person yes leaves no artefact unless someone makes one. Tracked here rather
than as a plan task because it belongs to the engagement, not to the build.

**Consequences**: A visible one-off dip in consent rate after deploy, which should be
flagged to the Chamber in advance so it is not read as a bug or a traffic problem. The
bump ties Phase 3 to a single release — the notice, the fields, and the version must
ship together or the notice describes a state the app is not in.

**Applied to**:
- [design.md](./design.md) § Decision summary
- [plan.md](./plan.md) § Phase 3, Task T-14
- [verification.md](./verification.md) § Phase 3 exit

---

## Round 3

Re-reading the documents after round 2 surfaced no new one-way doors. Remaining choices
are two-way and recorded as one-liners in [plan.md](./plan.md) § Decisions.
