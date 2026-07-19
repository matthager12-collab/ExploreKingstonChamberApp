// Pure form-engine types (no runtime code): the DomainDef pattern the listings
// workbench established, moved out of src/app/admin/listings/editor.tsx so the
// shared record editor (src/components/admin/record-editor.tsx) and the domain
// schema modules can both speak it (E07, vk/editor-engine).

import type { z } from "zod";

export type FieldKind = "text" | "textarea" | "number" | "select" | "checkbox" | "csv-tags";

/** One record as the editor sees it — id plus whatever the domain's type holds. */
export type GenericRecord = { id: string } & Record<string, unknown>;

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  /** for kind "select" */
  options?: { value: string; label: string }[];
  /** save is blocked while empty (the schema enforces it; kept for readability) */
  required?: boolean;
  /** the type marks this field `?` — omit it from the record when empty */
  optional?: boolean;
  /** starting value for new records */
  defaultValue?: string;
  placeholder?: string;
  help?: string;
  /** render across the full form width */
  wide?: boolean;
};

export type DomainDef = {
  key: string;
  label: string;
  noun: string;
  publicPath: string;
  fields: FieldDef[];
  /** The domain's zod schema — the same object the API route validates with. */
  schema: z.ZodType;
};
