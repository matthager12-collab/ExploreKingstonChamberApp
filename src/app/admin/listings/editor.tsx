"use client";

// Listings workbench for the Chamber admin: Restaurants, Lodging, and Webcams
// on the shared schema-driven record editor (E07). Each domain is one
// DomainDef — field list + the same zod schema the API route validates with —
// assembled from src/lib/schemas; all machinery lives in
// src/components/admin/record-editor.tsx, which also mounts the E09
// Provenance strip and RecordHistory (restore) panel for every domain here.

import type { Lodging, Restaurant, Webcam } from "@/lib/types";
import type { DomainDef, GenericRecord } from "@/lib/schemas/form";
import { restaurantFields, restaurantSchema } from "@/lib/schemas/restaurant";
import { lodgingFields, lodgingSchema } from "@/lib/schemas/lodging";
import { webcamFields, webcamSchema } from "@/lib/schemas/webcam";
import { RecordEditor } from "@/components/admin/record-editor";

type DomainKey = "restaurants" | "lodging" | "webcams";

const DOMAINS: DomainDef[] = [
  {
    key: "restaurants",
    label: "Eat & Drink",
    noun: "restaurant",
    publicPath: "/eat",
    fields: restaurantFields,
    schema: restaurantSchema,
  },
  {
    key: "lodging",
    label: "Lodging",
    noun: "lodging listing",
    publicPath: "/stay",
    fields: lodgingFields,
    schema: lodgingSchema,
  },
  {
    key: "webcams",
    label: "Webcams",
    noun: "webcam",
    publicPath: "/webcams",
    fields: webcamFields,
    schema: webcamSchema,
  },
];

export function ListingsEditor({
  initial,
  seedIds,
}: {
  initial: { restaurants: Restaurant[]; lodging: Lodging[]; webcams: Webcam[] };
  seedIds: Record<DomainKey, string[]>;
}) {
  return (
    <RecordEditor
      domains={DOMAINS}
      initial={initial as unknown as Record<string, GenericRecord[]>}
      seedIds={seedIds}
    />
  );
}
