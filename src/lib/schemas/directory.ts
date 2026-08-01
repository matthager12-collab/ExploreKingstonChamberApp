// Directory domain (E17): the landing zone for imported, non-curated
// listings — everything the Qwick kiosk feed carried that is not a verified
// restaurant/lodging/charity record. No public surface renders this domain
// yet (E17 non-goal); records are admin-and-owner-facing until a later epic
// gives them a public page deliberately.
//
// `sourceCategories`/`sourceImages` are import provenance, admin-facing only.
// sourceImages holds the vendor's (Cloudinary) URLs purely as a paper trail —
// they must never be rendered publicly (E17 Never tier; a grep gate asserts
// `cloudinary` appears nowhere under src/app or src/components).

import { z } from "zod";
import type { FieldDef } from "./form";
import {
  httpUrlOptional,
  idSchema,
  optionalTrimmed,
  requiredTrimmed,
  tagsSchema,
  trimOrEmpty,
} from "./shared";

export const DIRECTORY_CATEGORIES = [
  "eat",
  "stay",
  "shop",
  "services",
  "activities",
  "community",
  "other",
] as const;
export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number];

export const DIRECTORY_DESCRIPTION_MAX = 2000;

export const directoryListingSchema = z.object({
  id: idSchema,
  name: requiredTrimmed("name"),
  category: z.preprocess(
    trimOrEmpty,
    z.enum(
      DIRECTORY_CATEGORIES,
      `category must be one of: ${DIRECTORY_CATEGORIES.join(", ")}`,
    ),
  ),
  description: z.preprocess(
    trimOrEmpty,
    z
      .string()
      .max(
        DIRECTORY_DESCRIPTION_MAX,
        `description must be ${DIRECTORY_DESCRIPTION_MAX} characters or fewer`,
      ),
  ),
  address: optionalTrimmed(),
  phone: optionalTrimmed(),
  website: httpUrlOptional("website"),
  tags: tagsSchema,
  /** Raw upstream category strings, preserved verbatim so a human can refine
   *  the checked-in category mapping later. Absent on hand-created records. */
  sourceCategories: z.array(z.string()).optional(),
  /** Vendor image URLs kept as provenance only — never rendered publicly. */
  sourceImages: z
    .object({
      logo: optionalTrimmed(),
      listingImage: optionalTrimmed(),
    })
    .optional(),
});

export type DirectoryListingParsed = z.infer<typeof directoryListingSchema>;

export const directoryFields: FieldDef[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  {
    key: "category",
    label: "Category",
    kind: "select",
    defaultValue: "other",
    options: [
      { value: "eat", label: "Eat & Drink" },
      { value: "stay", label: "Stay" },
      { value: "shop", label: "Shop" },
      { value: "services", label: "Services" },
      { value: "activities", label: "Activities" },
      { value: "community", label: "Community" },
      { value: "other", label: "Other" },
    ],
  },
  { key: "description", label: "Description", kind: "textarea", wide: true },
  { key: "address", label: "Address (optional)", kind: "text", optional: true },
  {
    key: "phone",
    label: "Phone (optional)",
    kind: "text",
    optional: true,
    placeholder: "360-555-0100",
  },
  {
    key: "website",
    label: "Website (optional)",
    kind: "text",
    optional: true,
    placeholder: "https://…",
  },
  {
    key: "tags",
    label: "Tags (comma-separated)",
    kind: "csv-tags",
    wide: true,
    placeholder: "Downtown, Family friendly",
  },
];
