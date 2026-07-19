// Compile-time drift alarm (E07): each schema's inferred output must stay
// mutually assignable with its interface in src/lib/types.ts. The interface
// remains the type the rest of the app imports; this file just makes
// schema/type divergence an `npx tsc --noEmit` failure. No runtime code —
// `import type` keeps every import erased from the bundles.
//
// The bar is mutual ASSIGNABILITY, not identical optionality tokens: if an
// assertion here won't line up, fix the schema, not the interface (touching
// src/lib/types.ts is ask-first per the E07 charter).

import type { z } from "zod";
import type { Itinerary, ItineraryStop, Lodging, Restaurant, Webcam } from "@/lib/types";
import type { itinerarySchema } from "./itinerary";
import type { lodgingSchema } from "./lodging";
import type { restaurantSchema } from "./restaurant";
import type { webcamSchema } from "./webcam";

/** true only when A and B are assignable in BOTH directions. */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Instantiating Assert<false> is the compile error that flags the drift. */
type Assert<T extends true> = T;

export type RestaurantParity = Assert<
  MutuallyAssignable<z.infer<typeof restaurantSchema>, Restaurant>
>;
export type LodgingParity = Assert<MutuallyAssignable<z.infer<typeof lodgingSchema>, Lodging>>;
export type WebcamParity = Assert<MutuallyAssignable<z.infer<typeof webcamSchema>, Webcam>>;
export type ItineraryParity = Assert<
  MutuallyAssignable<z.infer<typeof itinerarySchema>, Itinerary>
>;
export type ItineraryStopParity = Assert<
  MutuallyAssignable<z.infer<typeof itinerarySchema>["stops"][number], ItineraryStop>
>;
