// Itinerary domain: one schema for the admin API route and the /admin/itineraries
// builder (E07, vk/domain-schemas). The builder's nested-stops UI stays bespoke;
// only its validation lives here. No FieldDef list — this domain doesn't run on
// the generic form engine.

import { z } from "zod";
import type { Itinerary, ItineraryStop } from "@/lib/types";
import { idSchema, requiredTrimmed, slugSchema, tagsSchema, trimOrEmpty, trimmedText } from "./shared";

export const ITINERARY_MODES = ["walk-on", "car", "either"] as const;

// Ported verbatim from the old sanitizeItinerary loop: index-aware messages
// ("stop 2 needs a title"), stops rebuilt from known fields, empty mapQuery
// omitted. A transform (not z.array) so the exact message set survives.
const stopsSchema = z.any().transform((v, ctx): ItineraryStop[] => {
  if (!Array.isArray(v) || v.length === 0) {
    ctx.addIssue({ code: "custom", message: "at least one stop required" });
    return z.NEVER;
  }
  const stops: ItineraryStop[] = [];
  for (let i = 0; i < v.length; i++) {
    const raw: unknown = v[i];
    if (!raw || typeof raw !== "object") {
      ctx.addIssue({ code: "custom", message: `stop ${i + 1} is malformed` });
      return z.NEVER;
    }
    const s = raw as Record<string, unknown>;
    const title = trimOrEmpty(s.title);
    if (!title) {
      ctx.addIssue({ code: "custom", message: `stop ${i + 1} needs a title` });
      return z.NEVER;
    }
    const mapQuery = trimOrEmpty(s.mapQuery);
    stops.push({
      time: trimOrEmpty(s.time),
      title,
      description: trimOrEmpty(s.description),
      ...(mapQuery ? { mapQuery } : {}),
    });
  }
  return stops;
});

export const itinerarySchema = z.object({
  id: idSchema,
  slug: slugSchema,
  title: requiredTrimmed("title"),
  tagline: trimmedText(),
  duration: trimmedText(),
  mode: z.preprocess(
    trimOrEmpty,
    z.enum(ITINERARY_MODES, "mode must be walk-on, car, or either"),
  ),
  audience: tagsSchema,
  stops: stopsSchema,
});

/** The one rule that needs a store read, kept out of zod so it stays pure and
 *  unit-testable: two live records must never share a slug — getItinerary(slug)
 *  would only ever find one of them. The route supplies `existing`. */
export function findItinerarySlugClash(
  existing: Itinerary[],
  record: Itinerary,
): Itinerary | undefined {
  return existing.find((i) => i.slug === record.slug && i.id !== record.id);
}
