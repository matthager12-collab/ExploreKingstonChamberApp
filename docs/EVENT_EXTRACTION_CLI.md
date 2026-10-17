# Paste a post through the local CLI

The business event form submits pasted text to the existing durable research
queue. It does not fetch Facebook or Instagram. The Mac worker uses its existing
Claude login to extract form suggestions with Haiku. This mode has no built-in
or MCP tools and no API-key fallback. Text is still sent to Anthropic; the form
discloses that before submission. CLI restrictions are not an OS sandbox.

The existing research assistant retains its separate web-research tool mode and
admin-only publication workflow. Extraction jobs are typed in the JSON payload,
excluded from the research list, and rejected by research review/publication.
Only the exact submitter who still manages the stored listing may read or cancel
an extraction, including when another submitter is an administrator. Ordinary
event saving and its existing moderation rules remain the publication boundary.

## Operation and limits

`node scripts/chamber-research-worker.mjs --once` claims at most one job. Without
`--once`, the existing worker polls every 15 seconds and runs one job at a time.
Its portal connection uses `CHAMBER_PORTAL_URL` and the existing
`CHAMBER_RESEARCH_TOKEN` machine credential over HTTPS (HTTP only on loopback).
The machine credential never enters the model subprocess. Extraction also
excludes `ANTHROPIC_API_KEY`, database credentials, and arbitrary environment
variables; it uses the operator's CLI authentication. Research mode is unchanged.

Extraction uses the fixed `claude-haiku-4-5-20251001` model, at most three turns,
90 seconds, and 128 KB of CLI output. These limits do not guarantee a Max quota
or dollar cap. Submissions accept at most 8,000 characters and 40 KB of JSON,
with a per-account limit of 12 submissions per ten minutes. Retrying a transport
error reuses the request UUID and does not create a second queue job. Every
model response is validated again on the server before returning form values.

The form shows **Waiting for computer** until a worker claims the job and
**Reading post** while it runs. Missing/offline workers do not imply success.
Cancel, editing the pasted text, and manual fallback cancel the current job;
late completions cannot fill a different form. Transport failures retain the
pasted text. Reload does not currently resume polling automatically; the queue
survives but the page must remain open to receive its result.

Raw pasted text is cleared after successful extraction and on cancellation.
Jobs/results expire after 24 hours: reads deny expired results and scrub them;
worker claim sweeps scrub expired stored input/results. This is not timed
physical deletion while the application and worker are both idle. Ordinary
backup retention also applies. Existing research privacy export/deletion uses
the submitter's email; restored jobs preserve submitter isolation and never
restore active lease credentials. No pasted text or model output is logged.

## Activation boundary

This change does not install a Mac background service or provision a secret.
The PR #244 owner separately configured the Render machine token; do not replace,
rotate, copy into a document, or ask them to send its value in chat.

After code and local review pass, release coordination must approve the exact
candidate and secure Mac provisioning/startup. Store the machine credential in
an approved secret store, load it without argv or log exposure, and verify the
existing Claude login. Use the documented worker command from the approved
checkout. Do not install a persistent LaunchAgent or create a replacement token
as part of local QA. Stop the owned foreground process to stop local rehearsal.

Automatic social collection remains disabled until the account owner authorizes
specific sources and access. This importer is manual paste plus human review.
