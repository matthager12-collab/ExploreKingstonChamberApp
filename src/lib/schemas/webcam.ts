// Webcam domain: one schema for the admin API route and the listings
// workbench form (E07, vk/domain-schemas). Field list moved verbatim from the
// workbench's DOMAINS array.

import { z } from "zod";
import type { FieldDef } from "./form";
import { httpUrlRequired, idSchema, requiredTrimmed, roundedInt, trimmedText } from "./shared";

export const webcamSchema = z.object({
  id: idSchema,
  name: requiredTrimmed("name"),
  location: trimmedText(),
  imageUrl: httpUrlRequired("imageUrl must be an http(s) URL to a still image"),
  sourceUrl: httpUrlRequired("sourceUrl must be an http(s) URL (credit/link-back page)"),
  source: trimmedText(),
  refreshSeconds: roundedInt(15, 3600, "refreshSeconds"),
});

export const webcamFields: FieldDef[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  {
    key: "location",
    label: "Location (one-line description)",
    kind: "text",
    placeholder: "SR 104 at Lindvog Road",
  },
  {
    key: "imageUrl",
    label: "Image URL",
    kind: "text",
    required: true,
    wide: true,
    placeholder: "https://images.wsdot.wa.gov/…jpg",
    help: "Direct link to the still JPEG — the grid polls it with a cache-buster.",
  },
  {
    key: "sourceUrl",
    label: "Source page URL",
    kind: "text",
    required: true,
    wide: true,
    placeholder: "https://wsdot.com/ferries/…",
    help: "Credit/link-back page, per the source's embedding terms.",
  },
  { key: "source", label: "Source (credit)", kind: "text", placeholder: "WSDOT" },
  {
    key: "refreshSeconds",
    label: "Refresh (seconds)",
    kind: "number",
    defaultValue: "60",
    help: "How often the image updates at the source (15–3600).",
  },
];
