// One zod schema per editable content domain (E07, vk/domain-schemas).
// DOMAIN_SCHEMAS is keyed by the /api/admin/content-records domain names;
// docs/SCHEMAS.md describes how a future domain (E08 UGC, E12 events, E17
// imports) joins the pattern.

import { directoryListingSchema } from "./directory";
import { eventSchema } from "./event";
import { itinerarySchema } from "./itinerary";
import { lodgingSchema } from "./lodging";
import { restaurantSchema } from "./restaurant";
import { webcamSchema } from "./webcam";

export const DOMAIN_SCHEMAS = {
  itineraries: itinerarySchema,
  lodging: lodgingSchema,
  webcams: webcamSchema,
  restaurants: restaurantSchema,
  events: eventSchema,
  directory: directoryListingSchema,
} as const;

export type SchemaDomain = keyof typeof DOMAIN_SCHEMAS;

export * from "./directory";
export * from "./event";
export * from "./form";
export * from "./itinerary";
export * from "./lodging";
export * from "./restaurant";
export * from "./shared";
// volunteer-needs is deliberately NOT in DOMAIN_SCHEMAS: that map is keyed by
// the /api/admin/content-records workbench domains, and shifts are edited in
// the nonprofit portal instead (E20). The schema still ships from here so the
// portal route and tests share one source of truth.
export * from "./volunteer";
export * from "./webcam";
