// Minimal iCalendar (RFC 5545) tokenizer for the two Chamber-adjacent feeds
// (E12 pure core). Hand-rolled on purpose — the epic's dependency budget is
// exactly `rrule`; this parser covers what ChamberMaster/GrowthZone actually
// emits plus the recurrence properties the tests exercise, not the full RFC.
//
// PURE: text in, plain data out. No fetch, no fs, no clock.
//
// Verified trap this file exists to not fall into: VTIMEZONE blocks contain
// RRULE: and DTSTART: lines (the DST transition rules — see the committed
// fixture ams-grand-hallway-art-show-1770249.ics lines 8–24). Property
// extraction is scoped to VEVENT blocks only; a parser grepping the whole
// file for RRULE would hallucinate a yearly recurrence onto every AMS event.

import { wallTimeToInstant } from "./tz";

/** Default zone for floating (no TZID, no Z) date-times. Both ingest sources
 *  are Kingston-local; ChamberMaster declares America/Los_Angeles in its
 *  VTIMEZONE and stamps TZID on every DTSTART observed so far. */
const DEFAULT_ZONE = "America/Los_Angeles";

export interface ParsedDateTime {
  /** ISO instant (UTC) — for VALUE=DATE forms, Pacific midnight of the date. */
  iso: string;
  /** Set for VALUE=DATE forms ("YYYY-MM-DD"). */
  dateOnly?: string;
}

export interface ParsedVEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url?: string;
  start?: ParsedDateTime;
  end?: ParsedDateTime;
  allDay: boolean;
  /** Raw RRULE value, e.g. "FREQ=WEEKLY;BYDAY=WE;COUNT=8". */
  rrule?: string;
  /** EXDATE instants (ISO); date-only EXDATEs anchor to Pacific midnight. */
  exdates: string[];
  /** RECURRENCE-ID original-occurrence instant (ISO). */
  recurrenceId?: string;
}

export interface ParsedCalendar {
  events: ParsedVEvent[];
  /** Non-fatal oddities (unparseable dates, missing DTSTART) — the per-run
   *  ingest report surfaces these; a bad VEVENT never throws. */
  warnings: string[];
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** §3.1 unfolding: a CRLF (or LF) followed by space/tab continues the line. */
export function unfoldLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw !== "") {
      out.push(raw);
    }
  }
  return out;
}

/** Split `NAME;PARAM=VAL;PARAM="quo:ted":VALUE` respecting quoted params. */
export function parseContentLine(line: string): ContentLine | null {
  let inQuotes = false;
  let colonAt = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colonAt = i;
      break;
    }
  }
  if (colonAt === -1) return null;
  const value = line.slice(colonAt + 1);
  const nameAndParams = line.slice(0, colonAt);

  // Same quote-aware walk for the ; separators inside the name part.
  const segments: string[] = [];
  let seg = "";
  inQuotes = false;
  for (const ch of nameAndParams) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ";" && !inQuotes) {
      segments.push(seg);
      seg = "";
    } else {
      seg += ch;
    }
  }
  segments.push(seg);

  const name = segments[0].trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of segments.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return { name, params, value };
}

/** §3.3.11 TEXT unescaping: \n \N \, \; \\ . */
export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\" || i === value.length - 1) {
      out += ch;
      continue;
    }
    const next = value[++i];
    if (next === "n" || next === "N") out += "\n";
    else if (next === "," || next === ";" || next === "\\") out += next;
    else out += "\\" + next; // unknown escape: keep both chars
  }
  return out;
}

const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

/** One iCal date or date-time value → instant, honoring VALUE=DATE / TZID / Z /
 *  floating (source-local Pacific). Returns null on garbage. */
export function parseICalDate(
  value: string,
  params: Record<string, string>,
): ParsedDateTime | null {
  const v = value.trim();
  if (params.VALUE === "DATE" || DATE_RE.test(v)) {
    const m = v.match(DATE_RE);
    if (!m) return null;
    const [, y, mo, d] = m;
    const midnight = wallTimeToInstant(DEFAULT_ZONE, Number(y), Number(mo), Number(d));
    return { iso: midnight.toISOString(), dateOnly: `${y}-${mo}-${d}` };
  }
  const m = v.match(DATE_TIME_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zulu] = m;
  if (zulu === "Z") {
    return {
      iso: new Date(
        Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
      ).toISOString(),
    };
  }
  const zone = params.TZID || DEFAULT_ZONE;
  return {
    iso: wallTimeToInstant(
      zone,
      Number(y),
      Number(mo),
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    ).toISOString(),
  };
}

/**
 * Parse a VCALENDAR text into its VEVENTs. Tolerant by design: a malformed
 * VEVENT is skipped with a warning (soft-fail — the ingest report records it),
 * never a throw. Only properties at VEVENT depth are read: VTIMEZONE blocks
 * (with their RRULE/DTSTART transition rules) and VALARM sub-blocks are
 * skipped entirely.
 */
export function parseICalendar(text: string): ParsedCalendar {
  const warnings: string[] = [];
  const events: ParsedVEvent[] = [];

  let inEvent = false;
  /** Depth of non-VEVENT blocks we are inside (VTIMEZONE, VALARM, …). */
  let skipDepth = 0;
  let current: ParsedVEvent | null = null;

  for (const line of unfoldLines(text)) {
    const parsed = parseContentLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === "BEGIN") {
      const block = value.trim().toUpperCase();
      if (block === "VEVENT" && !inEvent && skipDepth === 0) {
        inEvent = true;
        current = {
          uid: "",
          summary: "",
          description: "",
          location: "",
          allDay: false,
          exdates: [],
        };
      } else if (block !== "VCALENDAR") {
        skipDepth++;
      }
      continue;
    }
    if (name === "END") {
      const block = value.trim().toUpperCase();
      if (block === "VEVENT" && inEvent && skipDepth === 0) {
        inEvent = false;
        if (current) {
          if (!current.start) {
            warnings.push(`VEVENT ${current.uid || "(no uid)"} has no parseable DTSTART — skipped`);
          } else if (!current.uid) {
            warnings.push(`VEVENT "${current.summary || "(untitled)"}" has no UID — skipped`);
          } else {
            events.push(current);
          }
        }
        current = null;
      } else if (block !== "VCALENDAR" && skipDepth > 0) {
        skipDepth--;
      }
      continue;
    }

    if (!inEvent || skipDepth > 0 || !current) continue;

    switch (name) {
      case "UID":
        current.uid = value.trim();
        break;
      case "SUMMARY":
        current.summary = unescapeText(value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value).trim();
        break;
      case "LOCATION":
        current.location = unescapeText(value).trim();
        break;
      case "URL":
        // URI value type — no TEXT unescaping.
        if (value.trim()) current.url = value.trim();
        break;
      case "DTSTART": {
        const dt = parseICalDate(value, params);
        if (dt) {
          current.start = dt;
          if (dt.dateOnly) current.allDay = true;
        } else {
          warnings.push(`unparseable DTSTART "${value}"`);
        }
        break;
      }
      case "DTEND": {
        const dt = parseICalDate(value, params);
        if (dt) current.end = dt;
        else warnings.push(`unparseable DTEND "${value}"`);
        break;
      }
      case "RRULE":
        current.rrule = value.trim();
        break;
      case "EXDATE":
        // May appear multiple times per VEVENT, each with comma-separated
        // values, each line with its own TZID/VALUE params.
        for (const part of value.split(",")) {
          const dt = parseICalDate(part, params);
          if (dt) current.exdates.push(dt.iso);
          else warnings.push(`unparseable EXDATE "${part}"`);
        }
        break;
      case "RECURRENCE-ID": {
        const dt = parseICalDate(value, params);
        if (dt) current.recurrenceId = dt.iso;
        else warnings.push(`unparseable RECURRENCE-ID "${value}"`);
        break;
      }
      default:
        break; // X-ALT-DESC and friends: deliberately ignored
    }
  }

  return { events, warnings };
}
