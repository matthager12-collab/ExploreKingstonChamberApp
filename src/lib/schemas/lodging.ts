// Lodging domain: one schema for the admin API route and the listings
// workbench form (E07, vk/domain-schemas). Field list moved verbatim from the
// workbench's DOMAINS array.

import { z } from "zod";
import type { FieldDef } from "./form";
import {
  httpUrlOptional,
  idSchema,
  optionalTrimmed,
  requiredTrimmed,
  tagsSchema,
  trimOrEmpty,
  trimmedText,
} from "./shared";

export const LODGING_TYPES = ["hotel", "vacation-rental", "bnb", "camping", "marina"] as const;

export const lodgingSchema = z.object({
  id: idSchema,
  name: requiredTrimmed("name"),
  type: z.preprocess(
    trimOrEmpty,
    z.enum(LODGING_TYPES, `type must be one of: ${LODGING_TYPES.join(", ")}`),
  ),
  description: trimmedText(),
  address: optionalTrimmed(),
  website: httpUrlOptional("website"),
  bookingUrl: httpUrlOptional("bookingUrl"),
  tags: tagsSchema,
});

export const lodgingFields: FieldDef[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  {
    key: "type",
    label: "Type",
    kind: "select",
    defaultValue: "hotel",
    options: [
      { value: "hotel", label: "Hotel" },
      { value: "vacation-rental", label: "Vacation rental" },
      { value: "bnb", label: "B&B" },
      { value: "camping", label: "Camping" },
      { value: "marina", label: "Marina" },
    ],
  },
  { key: "description", label: "Description", kind: "textarea", wide: true },
  {
    key: "address",
    label: "Address (optional)",
    kind: "text",
    optional: true,
    help: "Shown as a Map link on /stay.",
  },
  {
    key: "website",
    label: "Website (optional)",
    kind: "text",
    optional: true,
    placeholder: "https://…",
  },
  {
    key: "bookingUrl",
    label: "Booking URL (optional)",
    kind: "text",
    optional: true,
    placeholder: "https://…",
  },
  {
    key: "tags",
    label: "Tags (comma-separated)",
    kind: "csv-tags",
    wide: true,
    placeholder: "Waterfront, Dining on site, About 10 min drive",
  },
];
