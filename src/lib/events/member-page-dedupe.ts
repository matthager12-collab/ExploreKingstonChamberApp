import { createHash } from "node:crypto";

/**
 * Stable identity for a drafted event: lowercased, punctuation-stripped,
 * whitespace-collapsed title + "|" + the YYYY-MM-DD part of start.
 * Re-scrapes of the same page produce the same key, so a dismissed or
 * published draft is never re-created.
 */
export function draftDedupeKey(title: string, start: string): string {
  const t = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${t}|${start.slice(0, 10)}`).digest("hex");
}
