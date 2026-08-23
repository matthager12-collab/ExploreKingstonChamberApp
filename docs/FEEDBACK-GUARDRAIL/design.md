# Design: Feedback rudeness guardrail

## Context

The site-wide feedback tab is mounted once in `SiteChrome` and therefore appears on
every public page. It collects a 1–5 star rating and one free-text comment, and
records the path it was sent from.

The existing pieces this design lands between:

| Concern | Lives in |
|---|---|
| Widget | `src/components/feedback-tab.tsx` |
| Offline queue / replay | `src/lib/outbox.ts` |
| Intake route | `src/app/api/feedback/route.ts` |
| Store + aggregate | `src/lib/feedback-store.ts` |
| Append-only DB layer | `src/lib/db/append.ts`, `src/lib/db/schema.ts` |
| Type + field caps | `src/lib/types.ts` |
| Editable copy | `src/lib/site-copy-registry.ts` |
| Privacy registry | `src/lib/privacy/pii-inventory.ts` |
| Retention | `src/lib/db/privacy-retention.ts` |
| Public notice | `src/app/(site)/privacy/page.tsx`, `docs/PRIVACY.md` |

### The three constraints that shape everything below

**1. The feedback store is deliberately identifier-free.** `src/lib/types.ts:271-278`
carries an explicit instruction:

> *NO contact field, by design: the widget never asks for one, so the store holds no
> identifier to look a person up by. […] Do not add an email field here without also
> giving `feedback_response` real find/export/delete handlers in `PII_STORES`.*

`src/app/api/feedback/route.ts` restates it, and `src/lib/privacy/pii-inventory.ts:298`
registers the store via the `noIdentifierStore(…)` helper. Adding contact fields is
therefore not a widget change with a route change behind it — it is a change to a
published privacy claim, enforced by a coverage test.

**2. The route must never fail the visitor over telemetry.** The existing save is
wrapped so a store outage logs and returns `{ok: true}` rather than 500ing. Any new
external dependency in that path inherits the same rule.

**3. Shipped migrations are frozen.** `feedback_response.response` is a JSONB column
(`src/lib/db/schema.ts:230`), so every field this design adds is additive inside that
document. No migration is written, and none is needed.

---

## Approach

A single sealed classifier call, inline in the POST path (per DEC-004), gated behind a
module that never throws (per DEC-006).

The model is given **no capability whatsoever**. It is one stateless
`client.messages.create` with no tools, no MCP, no retrieval, no conversation history
and no memory. There is no agent loop. Nothing the model emits can cause an action,
because there is no action available for it to reach.

That is the actual answer to "can't be infected by or used maliciously by prompt
injection": containment is structural, not a matter of prompt wording. The prompt
hardening below is defence in depth on top of a surface that has nothing to attack.

### Containment controls

| # | Control | Mechanism |
|---|---|---|
| C1 | No capability | One `messages.create`. No tools, no MCP, no retrieval, no history. |
| C2 | Constrained output shape | `output_config.format` with a JSON schema. The model can emit only `{ rude: boolean, cleaned: string }` — not prose, not a command, not a URL. |
| C3 | Untrusted text never in `system` | Visitor text goes in the `user` turn wrapped in `<visitor_comment>` delimiters. The system prompt states that everything inside is data to classify and never an instruction. |
| C4 | Output re-validated in code | Parsed with `zod` (already a dependency). Wrong type, wrong shape, or over-length is treated as *no result*. The model's word is never taken on trust. |
| C5 | No model text reaches the visitor | The reply the visitor reads is our own string from `site-copy-registry.ts`. The only model-authored text stored anywhere is `cleaned`, held as data and rendered by React (auto-escaped). No `dangerouslySetInnerHTML` anywhere on the path. |
| C6 | No PII is sent to the model | `name` and `email` are never in the request body. Only the comment — the field that was already the app's highest-risk text. |
| C7 | Hard budget | Input already capped at `FEEDBACK_COMMENT_MAX` (2000). `max_tokens: 1200`, 4s `AbortSignal.timeout`, `maxRetries: 1`. |
| C8 | Fail-open | Any error, timeout, unset key, or off-schema reply stores the comment as written and shows the ordinary thank-you. |
| C9 | Not called without a comment | Rating-only submissions never reach the model. That is the majority of them. |

C4 and C5 are the pair that matter most. C2 bounds what the model *can* say; C4
assumes C2 failed and checks anyway; C5 ensures that even a successful escape lands
in a string that is only ever stored and escaped, never interpreted.

### Model

`claude-haiku-4-5` — $1 / $5 per MTok, 200K context. No `thinking` (omitted, which on
that tier means off) and no `output_config.effort` (unsupported on that tier).

A 2000-character comment is roughly 500 input tokens plus a ~300-token system prompt,
against a bounded output. **Approximately $0.004 per commented submission.**

---

## Structure

```mermaid
graph TD
  W[feedback-tab.tsx] -->|submitOrQueue| OB[outbox.ts]
  OB -->|POST /api/feedback| R[route.ts]
  OB -.->|offline| IDB[(IndexedDB queue)]
  IDB -.->|replay| R
  R --> RL[rate-limit]
  R --> IK[idempotency claim]
  R --> M[feedback-moderation.ts]
  M -->|comment only| API[Anthropic Messages API<br/>claude-haiku-4-5]
  R --> S[feedback-store.ts]
  S --> DB[(feedback_response JSONB)]
  DB --> ADM[/admin/feedback]
  DB --> PII[pii-inventory.ts<br/>find / export / delete]
```

The dashed path is the offline case. Note that `feedback-moderation.ts` is reached
only from the route — never from the client, so the API key never leaves the server.

## Key flows

### Commented submission, model reachable

```mermaid
sequenceDiagram
  participant V as Visitor
  participant W as Widget
  participant R as /api/feedback
  participant M as moderateComment
  participant A as Anthropic
  participant D as Postgres

  V->>W: rating + comment (+ optional name/email)
  W->>R: POST
  R->>R: rate limit, validate, claim idempotency key
  R->>M: comment only (no name, no email)
  M->>A: messages.create — no tools, schema-constrained
  A-->>M: { rude, cleaned }
  M->>M: zod re-validate, length cap
  M-->>R: { checked: true, rude: true, cleaned }
  R->>D: save cleaned + moderated:true (original discarded)
  R-->>W: { ok: true, moderated: true }
  W-->>V: feedback.thankyou.moderated
```

The original text exists only in request memory. It is never written to Postgres, never
logged, and is discarded when the handler returns.

### Model unreachable — fail-open

```mermaid
sequenceDiagram
  participant R as /api/feedback
  participant M as moderateComment
  participant D as Postgres
  participant W as Widget

  R->>M: comment
  M--xM: timeout / 5xx / no API key / off-schema
  M-->>R: { checked: false }
  R->>D: save comment as written, no moderated flag
  R-->>W: { ok: true, moderated: false }
  W-->>W: feedback.thankyou (ordinary)
```

Per DEC-006 this is deliberate. A guardrail outage must not cost the Chamber a piece
of feedback, and must not tell a visitor their words were rewritten when they were not.

---

## Contracts

### `src/lib/feedback-moderation.ts` — new

```ts
export type ModerationResult =
  | { checked: false }                            // unconfigured, failed, or off-schema
  | { checked: true; rude: false }
  | { checked: true; rude: true; cleaned: string };

/** Never throws. Never returns model-authored text other than `cleaned`. */
export async function moderateComment(comment: string): Promise<ModerationResult>;
```

Modelled on `src/lib/email.ts`: an unset `ANTHROPIC_API_KEY` is a reported no-op, so
dev, CI, and a not-yet-configured production all degrade to "no moderation" without
throwing.

The response schema handed to the API:

```json
{
  "type": "object",
  "properties": {
    "rude": { "type": "boolean" },
    "cleaned": { "type": "string" }
  },
  "required": ["rude", "cleaned"],
  "additionalProperties": false
}
```

`cleaned` is re-validated in code as a non-empty string of at most
`FEEDBACK_COMMENT_MAX` characters. Anything else collapses to `{ checked: false }`.

> **T-01 finding, 2026-08-23: `output_config.format` is accepted on
> `claude-haiku-4-5`.** Confirmed by live smoke call. The `strict: true` tool fallback
> is **not needed and was not built**. Five cases returned schema-valid JSON in
> 0.78–1.68s, comfortably inside the 4s budget.
>
> Two things the smoke test settled beyond the mechanism:
>
> - **Substance survives the rewrite.** A rude comment carrying specifics — a bay
>   number, permit hours, a sailing time, a phone number — kept every one of them,
>   which is the risk DEC-003 accepted when it chose to discard the original.
> - **Contempt with no content needed a prompt fix.** *"Absolutely useless website.
>   Whoever made this should be embarrassed."* first rewrote to *"This website does not
>   meet my needs"* — inventing a stance the visitor never expressed, which the prompt
>   itself forbids. The instruction now names a fixed sentence for that case: *"The
>   visitor expressed dissatisfaction without giving specifics."* Re-verified.
>
> Prompt quality is not unit-tested (§ Testing strategy); this smoke run is the
> evidence, and the admin "rewritten" marker is the ongoing signal.

### `FeedbackResponse` — `src/lib/types.ts`

```ts
export interface FeedbackResponse {
  submittedAt: string;
  rating: number;
  comment?: string;
  path: string;
  /** Optional, unverified. Reply-to hint only. ≤ 80 chars. */
  name?: string;
  /** Optional, unverified. The privacy lookup key — see DEC-005. ≤ 254 chars. */
  email?: string;
  /** True when `comment` is a neutral rewrite, not what the visitor typed. */
  moderated?: boolean;
}
```

All three are optional, so every row written before this change stays valid without a
backfill.

### `POST /api/feedback`

Request gains two optional fields:

```jsonc
{
  "rating": 4,
  "comment": "…",
  "path": "/parking",
  "name": "…",        // optional, trimmed, ≤80, dropped if empty
  "email": "…"        // optional, trimmed, ≤254, dropped if not email-shaped
}
```

A malformed `email` is **dropped, not rejected**. The route's existing rule is that a
400 loses the whole submission, because the outbox deletes its copy on a 4xx — so a
typo'd address must not cost the Chamber the feedback.

Response gains one field:

```jsonc
{ "ok": true, "moderated": false }
```

`moderated` is present on every success, including duplicates (always `false` on a
duplicate — the original submission already reported its own result).

### `submitOrQueue` — `src/lib/outbox.ts`

```ts
Promise<{ status: "sent"; httpStatus: number; body?: unknown } | { status: "queued" }>
```

Purely additive, exactly like the `httpStatus` addition documented at
`src/lib/outbox.ts:197`. Callers reading only `.status` are unaffected. The widget
cannot see `moderated` without this.

### `feedback_response` as a `PiiStore`

Replaces the `noIdentifierStore(…)` registration:

```ts
{
  store: "feedback_response",
  hasEmailIdentifier: true,
  findByIdentifier(email),   // rows whose response->>'email' matches, case-insensitive
  exportRecords(email),      // those rows, with a note about identifier-free rows
  deleteOrAnonymize(email),  // hard delete — the comment IS the sensitive part
}
```

Deletion is a hard delete, not anonymisation, matching
`deleteFeedbackResponsesBefore` in `src/lib/db/privacy-retention.ts:205`: *"the comment
text IS the sensitive part, so there is nothing worth keeping a shell of."*

The `note` on both handlers must stay honest: rows submitted **without** an email are
still findable only by their own wording, exactly as today. Promoting the store does
not make the historic rows searchable, and the notice must not imply it does.

---

## Decision summary

| # | Decision | Where it shows up |
|---|---|---|
| DEC-001 | Claude Haiku 4.5 only; no second provider | § Approach, § Contracts |
| DEC-002 | Promote `feedback_response` to a full `PiiStore` | § Contracts, plan Phase 3 |
| DEC-003 | Store the cleaned rewrite only, plus a flag | § Key flows, § Contracts |
| DEC-004 | Moderate inline in the POST path | § Structure, § Key flows |
| DEC-005 | Unverified email accepted as the privacy lookup key | § Contracts, plan Phase 3 |
| DEC-006 | Fail-open on any moderation failure | § Containment controls, § Key flows |
| DEC-007 | Bump `PRIVACY_NOTICE_VERSION`, re-prompting every visitor | plan Phase 3 |

Full entries in [decisions.md](./decisions.md).

---

## Testing strategy

| Level | Proves |
|---|---|
| Unit — `feedback-moderation` | Containment. The SDK is mocked; assertions are on the **request shape** (no `tools` key, comment in the `user` turn only, name/email absent) and on fail-open behaviour for every failure mode. |
| Unit — route | Contact validation, malformed email dropped rather than 400'd, `moderated` persisted, and a replayed idempotency key making **no** model call. |
| Unit — widget | Moderated reply renders; contact fields are optional and never block submit. |
| Unit — PII inventory | The existing coverage test in `src/lib/privacy/pii-inventory.test.ts` is the tripwire. It should go red the moment the store gains an identifier, and green only when the handlers are real. |
| Manual | The injection probe (verification.md § Manual checks). |

**Deliberately not unit tested:** whether Haiku's rudeness judgement is *correct*. That
is a model-quality question, not a code question, and a test asserting it would be
asserting the model's behaviour rather than ours. The admin "rewritten" marker exists
so over-firing is visible in production instead.
