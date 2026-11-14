// One check of a member's saved events page: fetch -> text -> extract ->
// insert drafts. Shared by the member's "Check now" and the daily cron.

import { extractPageEvents } from "./extract-page-events";
import { fetchMemberPage, htmlToText } from "./member-page-fetch";
import { getEventPage, insertDrafts, recordCheck } from "@/lib/stores/member-event-page-store";

export type CheckResult =
  | { ok: true; found: number; added: number }
  | { ok: false; error: string };

/** Fixed, member-safe messages — never raw error text. */
const NOT_CONFIGURED = "Automatic event reading isn't switched on yet";
const EXTRACT_FAILED = "We couldn't read events from that page. We'll try again tomorrow";

/** Never throws for an expected failure; the outcome is also saved on the page row. */
export async function checkMemberEventPage(ownerId: string): Promise<CheckResult> {
  const page = await getEventPage(ownerId);
  if (!page) return { ok: false, error: "No events page is saved" };

  const fetched = await fetchMemberPage(page.url);
  if (!fetched.ok) {
    await recordCheck(ownerId, fetched.message);
    return { ok: false, error: fetched.message };
  }

  const extracted = await extractPageEvents(htmlToText(fetched.html));
  if (!extracted.ok) {
    const error = extracted.reason === "not-configured" ? NOT_CONFIGURED : EXTRACT_FAILED;
    await recordCheck(ownerId, error);
    return { ok: false, error };
  }

  const added = await insertDrafts(ownerId, extracted.events);
  await recordCheck(ownerId, null);
  return { ok: true, found: extracted.events.length, added };
}
