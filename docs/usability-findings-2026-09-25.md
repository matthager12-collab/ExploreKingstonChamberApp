# Usability findings: claim a listing (2026-09-25)

Brightwork pilot, plan task T-19. Flow: `/claim/<listing>` → create account → 6-digit code → claimed. Walked by Claude in the browser pane against a local dev server, a throwaway Postgres container and the `seed:claim-test` fixture, with a synthetic address (`pilot@example.test`) and no mail key set, so no email left the machine. Raw screenshots stayed in the session scratchpad; this file holds measurements only.

**Status: prepared, not merged.** The chamber is a signed class: the merge, its evidence and the live check are Mat's call. This branch (`brightwork-pilot-claim`) is local and has not been pushed.

## Before and after

One bounded change was built: the wrong-code message, and linking it to the code field.

| Measure | Before | After |
|---|---|---|
| Screens, start to done | 3 (listing, account form, code) | 3 |
| Interactions on the happy path | 7 (open, name, email, password, submit, code, verify) | 7 |
| Keyboard alone finishes the flow | yes (skip link, then Tab and Enter; focus moves into each new step) | yes |
| Input kept after an error | yes | yes |
| What a wrong code tells the user | "That code is invalid or has expired — please start again." A retry actually works (five tries allowed), so this sends people back to redo the whole form for nothing. | "That code is invalid or has expired. Check the six digits and try again. If it still fails, choose Cancel and start over for a new code." |
| Wrong code marks the field for screen readers | no (`aria-invalid` and `aria-describedby` absent) | yes, and the message stays one uniform refusal, as the security design requires |
| Checked at 375px and desktop | yes | yes |

Rules applied: **Actionable error notices** and **Preserve entered content** (`rules/usability.md`); **Error message association** (`rules/accessibility.md`).

Gates run on the change: `npm run typecheck` exit 0; eslint on both files exit 0; the two claim-signup test files 17/17; the full unit suite 2,556 passed, 6 skipped; Brightwork `check-slop` clean.

## Findings not fixed

Most severe first. Each names the Brightwork rule it breaks.

1. **Single primary action** (`usability.md`). The page says "Claim it below", but the only action is a small grey underlined link that reads like a footnote. On a phone it is the least prominent thing on screen.
2. **Actionable error notices** (`usability.md`). After a few signups in a row the form says "Too many requests, please try again later." It gives no wait time and no other route, such as the Chamber's phone number, which the page already shows elsewhere.
3. **Say where they are** (`usability.md`). The code screen says "We've emailed you a 6-digit code" but not which address, and offers no resend and no way to fix a mistyped email except Cancel.
4. **Focus not obscured** (`accessibility.md`, WCAG 2.2). At 375px the fixed "Give feedback" tab covers the right 23px of the form fields and their text.
5. **Inline validation guidance** (`usability.md`). A too-short password shows only the browser's own tooltip, which vanishes. The rule is already in the helper text, so the fix is small.
6. **Reading load** (`usability.md`). The form's text runs at the smallest size on the page. Check against the chamber's own type rules before changing it.

## How to reproduce

```bash
docker run -d --name bw-pilot-pg -e POSTGRES_PASSWORD=pilot -p 127.0.0.1:55432:5432 postgres:16
npm run seed:claim-test -- --yes --email pilot@example.test
npm run dev
```

Then open `/claim/test-claim-business`. The dev server prints each verification code to its log.
