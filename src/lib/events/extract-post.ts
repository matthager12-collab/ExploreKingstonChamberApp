// Validate untrusted CLI extraction output before it becomes editable form values.
// No model invocation, tools, provider credentials or publication capability.
import "server-only";
import { z } from "zod";
import type { EventCategory } from "@/lib/types";
import { instantToWallTime, wallTimeToInstant } from "./tz";

const CATEGORIES = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
] as const satisfies readonly EventCategory[];

/**
 * Longest post we will read. Social captions run to a few thousand characters;
 * 8k is generous for a caption and small enough that a pasted novel can't turn
 * one member into a billing incident. Truncation is never silent — the route
 * rejects anything longer (docs/OPERATIONS silent-cap rule).
 */
export const MAX_POST_CHARS = 8_000;

const CONFIDENCE_FLOOR = 0.6;

const extractionSchema = z.object({
  title: z.string().describe("The event's name, without hype or emoji."),
  start: z
    .string()
    .describe(
      "Local start as YYYY-MM-DDTHH:MM, or empty string if the post does not " +
        "give enough to be sure of the date. Never guess a year or a month.",
    ),
  end: z.string().describe("Local end as YYYY-MM-DDTHH:MM, or empty string."),
  venue: z.string().describe("Where it happens. Empty string if not stated."),
  description: z.string().describe("One or two plain sentences. No hashtags."),
  category: z.enum(CATEGORIES),
  url: z.string().describe("A ticket or info link found in the post, or empty string."),
  confidence: z
    .number()
    .describe("0 to 1: how sure you are this post announces ONE dated event."),
  notes: z
    .string()
    .describe("If unsure, the one thing a human should check. Else empty string."),
});

/** What the portal form pre-fills from. Field names match its EventDraft. */
export interface ExtractedDraft {
  title: string;
  start: string;
  end: string;
  venue: string;
  description: string;
  category: EventCategory;
  url: string;
  /** True when the model was not confident enough to be taken at its word. */
  unsure: boolean;
  /** What to check, shown beside the form. Empty when nothing stands out. */
  notes: string;
}

function validLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  // Year 0000 survives the round trip below but is no value a date box takes,
  // and no town calendar holds 1899 or 2101. The window is deliberately wide.
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  const parsed = new Date(`${value}:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 16) !== value) return false;
  // A calendar-valid time can still fall in Pacific's spring-forward gap.
  const parts = [year, Number(value.slice(5, 7)), Number(value.slice(8, 10)), Number(value.slice(11, 13)), Number(value.slice(14, 16))] as const;
  const wall = instantToWallTime("America/Los_Angeles", wallTimeToInstant("America/Los_Angeles", ...parts));
  return [wall.y, wall.mo, wall.d, wall.h, wall.mi].every((part, i) => part === parts[i]);
}

/**
 * Characters that change what a member reads without being visible: zero-width
 * space, word joiner, the byte-order mark, and the direction overrides and
 * isolates. Zero-width joiner and non-joiner stay, because emoji sequences and
 * some scripts need them.
 */
const INVISIBLE = /[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Clean, trim and cut to `max` WHOLE characters. Counting UTF-16 units, as
 * slice() does, can cut an emoji in half and leave a broken character.
 */
function tidy(value: string, max: number): string {
  return Array.from(value.replace(INVISIBLE, "").trim())
    .slice(0, max)
    .join("")
    .trim();
}

/** A real host name: dotted labels ending in a letter. Refuses ".", "a..b" and
 *  IP addresses, none of which is a ticket page. The URL parser has already
 *  turned an international name into its ASCII form. */
const HOST = /^([a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i;

/**
 * A link a member could click: http or https, a real host, no spaces, a sane
 * length. The route drops a non-http(s) url without comment, and a `javascript:`
 * string must never reach an href, so neither reaches the form. A bare "https://"
 * passes a scheme check and is no link at all; hence the parse.
 */
function safeLink(value: string): string {
  const link = value.trim();
  if (!link || link.length > 500 || /\s/.test(link)) return "";
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    // A name and password in a link make it point somewhere other than where it
    // reads: https://tickets.example:pass@evil.example/ goes to evil.example.
    if (parsed.username || parsed.password) return "";
    if (!HOST.test(parsed.hostname)) return "";
  } catch {
    return "";
  }
  return link;
}

/** Anything the model returns is a suggestion; these are the house rules. */
function clampDraft(raw: z.infer<typeof extractionSchema>): ExtractedDraft | null {
  // Checked on the FINAL title, after cleaning and cutting. Checked before, a
  // visible letter behind 200 hidden characters passed the check and was lost in
  // the cut, leaving a title nobody can see.
  const title = tidy(raw.title, 200);
  if (!/[\p{L}\p{N}]/u.test(title)) return null;

  const start = validLocalDateTime(raw.start) ? raw.start : "";
  // An end with no start means nothing, and would leave the form showing one.
  const end = start && validLocalDateTime(raw.end) && raw.end > start ? raw.end : "";
  const url = safeLink(raw.url);

  // A confidence outside 0 to 1 means the model is not doing what it was asked.
  // That is a reason to look harder, never a way to switch the warning off.
  const inRange = Number.isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1;
  // No date means nothing to confirm, whatever the model claims about itself.
  const unsure = !inRange || raw.confidence < CONFIDENCE_FLOOR || !start;

  return {
    title,
    start,
    end,
    venue: tidy(raw.venue, 200),
    description: tidy(raw.description, 2000),
    category: raw.category,
    url,
    unsure,
    // The note is the model's own words. It reaches the member only inside the
    // app's "check this" warning, and never from a reading that broke its range.
    notes: unsure && inRange ? tidy(raw.notes, 300) : "",
  };
}

export function clampPostExtraction(value: unknown): ExtractedDraft | null {
  const parsed = extractionSchema.safeParse(value);
  return parsed.success ? clampDraft(parsed.data) : null;
}
