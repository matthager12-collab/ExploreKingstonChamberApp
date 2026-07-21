// Restaurant domain: one schema for the admin API route, the listings
// workbench form, and the portal self-edit route (E07, vk/domain-schemas).
// Field list moved verbatim from the workbench's DOMAINS array.

import { z } from "zod";
import { accessFactsFields, accessFactsShape } from "./access";
import type { FieldDef } from "./form";
import {
  ISO_DATE_RE,
  httpUrlOptional,
  idSchema,
  numberInRange,
  optionalTrimmed,
  requiredTrimmed,
  roundedInt,
  tagsSchema,
  toNumber,
  trimOrEmpty,
  trimmedText,
  weeklyHoursSchema,
} from "./shared";

export const ORDERING_PLATFORMS = ["toast", "square", "doordash", "own-site", "phone-only"] as const;
export const PRICE_LEVELS = [1, 2, 3] as const;

export const restaurantSchema = z.object({
  id: idSchema,
  name: requiredTrimmed("name"),
  cuisine: requiredTrimmed("cuisine"),
  description: trimmedText(),
  address: requiredTrimmed("address"),
  phone: optionalTrimmed(),
  website: httpUrlOptional("website"),
  menuUrl: httpUrlOptional("menuUrl"),
  orderingUrl: httpUrlOptional("orderingUrl"),
  orderingPlatform: z.preprocess(
    (v) => trimOrEmpty(v) || undefined,
    z
      .enum(
        ORDERING_PLATFORMS,
        `orderingPlatform must be one of: ${ORDERING_PLATFORMS.join(", ")}`,
      )
      .optional(),
  ),
  hours: optionalTrimmed(),
  // Structured hours: the admin route carries these over from the stored
  // record (the form can't edit them); the portal route validates
  // member-submitted ones before they land here.
  weeklyHours: weeklyHoursSchema.optional(),
  hoursVerified: z.preprocess(
    (v) => trimOrEmpty(v) || undefined,
    z
      .string()
      .regex(ISO_DATE_RE, "hoursVerified must be a date in YYYY-MM-DD format")
      .optional(),
  ),
  priceLevel: z.preprocess(
    (v) => Math.round(toNumber(v)),
    z.literal(PRICE_LEVELS, "priceLevel must be 1, 2, or 3"),
  ),
  tags: tagsSchema,
  lat: numberInRange("lat", -90, 90),
  lng: numberInRange("lng", -180, 180),
  walkMinutesFromFerry: roundedInt(0, 120, "walk minutes"),
  // Only `true` survives; false/absent parse to an omitted key — parity with
  // the old `...(body.hidden ? { hidden: true } : {})`.
  hidden: z.preprocess((v) => (v ? true : undefined), z.boolean().optional()),
  // E27 (M-14-05 app slice). Note `cost` is deliberately NOT here: restaurants
  // are paid by nature and keep priceLevel as their money signal.
  ...accessFactsShape,
});

export const restaurantFields: FieldDef[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  {
    key: "cuisine",
    label: "Cuisine / type",
    kind: "text",
    required: true,
    placeholder: "Pizza · Coffee & cafe · American pub",
    help: "The short line shown next to the price on the card.",
  },
  {
    key: "description",
    label: "Description",
    kind: "textarea",
    wide: true,
    help: "The blurb visitors read on the Eat & Drink card. A sentence or two.",
  },
  {
    key: "hidden",
    label: "Hide from the Eat & Drink page (keep the record to switch back on later)",
    kind: "checkbox",
    wide: true,
  },
  {
    key: "address",
    label: "Address",
    kind: "text",
    required: true,
    wide: true,
    placeholder: "11171 NE State Hwy 104, Kingston, WA 98346",
  },
  { key: "phone", label: "Phone (optional)", kind: "text", optional: true },
  {
    key: "website",
    label: "Website (optional)",
    kind: "text",
    optional: true,
    placeholder: "https://…",
  },
  {
    key: "menuUrl",
    label: "Menu URL (optional)",
    kind: "text",
    optional: true,
    placeholder: "https://…",
  },
  {
    key: "orderingUrl",
    label: "Online-ordering URL (optional)",
    kind: "text",
    optional: true,
    placeholder: "https://…",
    help: "Powers the “Order online” button.",
  },
  {
    key: "orderingPlatform",
    label: "Ordering type",
    kind: "select",
    optional: true,
    defaultValue: "",
    options: [
      { value: "", label: "— none —" },
      { value: "phone-only", label: "Phone only (Call to order)" },
      { value: "toast", label: "Toast" },
      { value: "square", label: "Square" },
      { value: "doordash", label: "DoorDash" },
      { value: "own-site", label: "Own site" },
    ],
    help: "“Phone only” shows a Call-to-order button; the others pair with the ordering URL.",
  },
  {
    key: "hours",
    label: "Hours (free text, optional)",
    kind: "text",
    optional: true,
    wide: true,
    placeholder: "Daily 11 am–8 pm",
    help: "The human-readable hours line. The live “Open now” badge is kept from the existing record and can't be edited here.",
  },
  {
    key: "priceLevel",
    label: "Price",
    kind: "select",
    defaultValue: "2",
    options: [
      { value: "1", label: "$ (inexpensive)" },
      { value: "2", label: "$$ (moderate)" },
      { value: "3", label: "$$$ (pricey)" },
    ],
  },
  {
    key: "walkMinutesFromFerry",
    label: "Walk minutes from the ferry",
    kind: "number",
    defaultValue: "5",
    help: "Sets which walk-time group the card lands in on /eat.",
  },
  {
    key: "lat",
    label: "Latitude",
    kind: "number",
    help: "Right-click the spot in Google Maps → the first number. e.g. 47.7973",
  },
  {
    key: "lng",
    label: "Longitude",
    kind: "number",
    help: "The second number from Google Maps. e.g. -122.4969",
  },
  {
    key: "tags",
    label: "Tags (comma-separated)",
    kind: "csv-tags",
    wide: true,
    placeholder: "quick, takeout, kid-friendly",
  },
  ...accessFactsFields,
];
