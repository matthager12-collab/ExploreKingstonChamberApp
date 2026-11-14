# ADR-0009 — Member event pages: a separate fetch path that only ever produces drafts

**Status:** Accepted (owner rulings, 2026-11-13)
**Amends:** [ADR-0002](ADR-0002-app-first-events-and-manual-exports.md) (the app is the events front door)

> Numbered 0009 because ADR-0008 is already taken by the race-registration decision.

## Context

ADR-0002 makes the app the front door for events: members submit them in-app, and everything
lands under the moderation floor. Typing each event in is the part members skip. Many
members (a tavern's "live music" page, say) already publish their schedule on their own website.
We want to read that page for them without opening a way for anyone to publish unreviewed
content, and without letting a member-supplied url reach anything it should not.

## Decision

Rulings made by the owner on 2026-11-13:

1. **Haiku runs server-side with the existing `ANTHROPIC_API_KEY`**, the same way
   `src/lib/feedback-moderation.ts` does. No CLI, no queue. One stateless call, no tools,
   reply pinned to a schema and re-validated per item.
2. **Nothing publishes without the member pressing Publish.** A check only writes *drafts*
   (`member_event_draft`). Drafts never appear publicly and nothing public reads them.
   Publish sends the draft through the existing `POST /api/portal/events`, so the moderation
   floor (hold for Chamber review, or the trusted-org bypass) applies exactly as for a hand-typed event.
3. **Member urls use their own fetch path.** Nothing is added to `SOURCE_ALLOWLIST` and
   `src/lib/events/ingest-http.ts` is untouched. The allowlist is a list of sources the Chamber
   chose; a member-typed url is untrusted input and gets its own guard in
   `src/lib/events/member-page-fetch.ts`: https only, port 443 only, no userinfo, address checked
   at connect time (defeats DNS rebinding), manual redirects (max 3) re-checked each hop,
   15 s and 2 MB limits, `text/html` or `text/plain` only.

Consequences that follow from those:

- **Duplicates.** Drafts enter as ordinary member events once published, so the existing
  dedupe precedence applies unchanged (in-app first, per ADR-0002 and ADR-0005). The page scrape
  ranks below every existing source whenever a duplicate clashes. It has no precedence of its own.
- **Re-scrapes are idempotent.** A draft's `dedupe_key` is a hash of the normalized title plus the
  date; `(owner_id, dedupe_key)` is unique and inserts are `ON CONFLICT DO NOTHING`. A dismissed
  or published draft is never re-created.
- **A guessed time is a wrong calendar.** An extracted event with no start time is dropped,
  not given a default.
- **Link.** A published event's link is always the member's saved page url. Model output
  never supplies a url.
- **Privacy.** The text of the member's public page is sent to Anthropic; no member name,
  email or account is. See PRIVACY.md.
- **Schedule.** Render cron `member-event-pages`, daily, reusing `EVENTS_INGEST_TOKEN`. A
  member can also press "Check now" (one per listing per 10 minutes).

## Alternatives not taken

- Adding member hosts to `SOURCE_ALLOWLIST`: it would make a member-typed value a trusted source.
- Auto-publishing extracted events: removes the human check that makes a model's mistakes cheap.

## Update 2026-11-13: repeats, untimed events, ticket links

A real venue page lost 6 of 7 events to the first rules. Owner ruling:

- **Repeating events become repeating drafts**, using only the existing repeat presets. Any other pattern is dropped. The model names the pattern; the server builds the rule and computes the first date.
- **Events with no time are kept**, flagged `time_missing`. A time is never guessed. The member must enter one before Publish.
- **Ticket links are kept** only when the url is exactly one of the page's own links (`extractLinks`). Otherwise the draft links to the member's page.
- Dedupe keys: timed one-off by start minute, untimed one-off by date, series by rule plus time (never the date, which moves every week).
