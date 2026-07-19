// One zod schema per editable content domain (E07, vk/domain-schemas).
// DOMAIN_SCHEMAS is keyed by the /api/admin/content-records domain names;
// docs/SCHEMAS.md describes how a future domain (E08 UGC, E12 events, E17
// imports) joins the pattern.

import { itinerarySchema } from "./itinerary";
import { lodgingSchema } from "./lodging";
import { restaurantSchema } from "./restaurant";
import { webcamSchema } from "./webcam";

export const DOMAIN_SCHEMAS = {
  itineraries: itinerarySchema,
  lodging: lodgingSchema,
  webcams: webcamSchema,
  restaurants: restaurantSchema,
} as const;

export type SchemaDomain = keyof typeof DOMAIN_SCHEMAS;

export * from "./form";
export * from "./itinerary";
export * from "./lodging";
export * from "./restaurant";
export * from "./shared";
export * from "./webcam";
