// Store write-gate schemas. The four editable content domains (restaurants,
// lodging, webcams, itineraries) use the strict E07 domain schemas from
// src/lib/schemas; every other store keeps its baseline structural rule.
//
// The strict swap ran 2026-07-19, after the docs/SCHEMAS.md "Wiring the
// importer" gate reported clean: every four-domain record in the git seeds
// AND the current post-cutover production backup bundle parses under
// DOMAIN_SCHEMAS (scripts/verify-bundle-domains.ts — production held zero
// four-domain records outside the seeds). Re-run that script against a fresh
// bundle before tightening any other entry.
//
// Baseline = structural, not exhaustive: the store's id shape plus the
// universally-required core field(s), everything else passed through
// untouched (z.looseObject). Required fields were checked against BOTH the
// git seeds and the 2026-07-10 production backup bundle — a field is only
// required here if 100% of real records have it (anything stricter sends
// legitimate data to quarantine on import). Verified realities that shape
// this file:
//  - site-copy ids are dotted copy keys ("home.hero.eyebrow") and site-pages
//    ids are route paths ("/ferry") — the entity id regex would reject every
//    real record in both stores, so they carry their own id rules;
//  - events use `start` (ISO), not `date`;
//  - tombstones can carry empty payloads (the one prod boarding-pass-override
//    row is exactly that), so deleted records validate as { id } only — see
//    validateRecord's `tombstone` option, used by the writeRecord choke point.

import { z } from "zod";
import { DOMAIN_SCHEMAS } from "@/lib/schemas";

/** Entity-store id rule — same regex src/app/api/admin/content-records/route.ts
 *  enforces. site-copy / site-pages override it below. */
export const RECORD_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export type StoreIssues = z.ZodError["issues"];

export class RecordValidationError extends Error {
  constructor(
    public readonly store: string,
    public readonly recordId: string | undefined,
    public readonly issues: StoreIssues,
  ) {
    super(
      `Invalid ${store} record${recordId ? ` '${recordId}'` : ""}: ` +
        issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
    this.name = "RecordValidationError";
  }
}

const entityId = z
  .string()
  .regex(RECORD_ID_RE, "1-64 chars of [a-zA-Z0-9-], starting alphanumeric");
/** site-copy ids are dotted copy keys, e.g. "home.hero.eyebrow". */
const copyKeyId = z.string().min(1).regex(/^\S+$/, "copy keys contain no whitespace");
/** site-pages ids are route paths, e.g. "/ferry". */
const pagePathId = z.string().regex(/^\/\S*$/, "page ids are route paths starting with /");

const ID_RULES: Record<string, z.ZodType<string>> = {
  "site-copy": copyKeyId,
  "site-pages": pagePathId,
};

export function idRuleFor(store: string): z.ZodType<string> {
  return ID_RULES[store] ?? entityId;
}

const nonempty = z.string().min(1);

/** One schema per store name (every store in the E05 table). */
export const STORE_SCHEMAS: Record<string, z.ZodType> = {
  restaurants: DOMAIN_SCHEMAS.restaurants,
  events: z.looseObject({ id: entityId, title: nonempty, start: nonempty }),
  charities: z.looseObject({ id: entityId, name: nonempty }),
  "volunteer-needs": z.looseObject({ id: entityId, title: nonempty, date: nonempty }),
  lodging: DOMAIN_SCHEMAS.lodging,
  webcams: DOMAIN_SCHEMAS.webcams,
  itineraries: DOMAIN_SCHEMAS.itineraries,
  "parking-zones": z.looseObject({ id: entityId, name: nonempty }),
  "map-views": z.looseObject({ id: entityId, name: nonempty }),
  "map-features": z.looseObject({ id: entityId, title: nonempty }),
  "site-copy": z.looseObject({ id: copyKeyId, text: z.string() }),
  "site-pages": z.looseObject({ id: pagePathId }),
  "ferry-info": z.looseObject({ id: entityId }),
  "ferry-prediction": z.looseObject({ id: entityId }),
  "boarding-pass-override": z.looseObject({ id: entityId }),
  "ferry-accuracy": z.looseObject({ id: entityId }),
  "custom-hunts": z.looseObject({ id: entityId, title: nonempty }),
  "hunt-submissions": z.looseObject({ id: nonempty }),
  "auth-users": z.looseObject({ id: entityId, email: nonempty }),
  // Invites are keyed by their code, mirrored into id (auth.ts ~line 51); the
  // importer replicates that mirror before validating.
  "auth-invites": z.looseObject({ id: nonempty, code: nonempty }),
  // E10 ops heartbeats. Permissive id (NOT entityId) on purpose: marker ids are
  // colon-namespaced ("backup:last-success", "job:<name>"), which the entity
  // regex rejects — but markers are overwrite-only and never tombstoned, so the
  // live-write nonempty rule is all that applies. `at` is always stamped by
  // recordMarker.
  "ops-markers": z.looseObject({ id: nonempty, at: nonempty }),
};

/** Unknown stores validate permissively ({ id } only) with a warn-once —
 *  a new store name must never crash a write path. */
const PERMISSIVE = z.looseObject({ id: nonempty });
const warned = new Set<string>();

export function schemaFor(store: string): z.ZodType {
  const schema = STORE_SCHEMAS[store];
  if (!schema) {
    if (!warned.has(store)) {
      warned.add(store);
      console.warn(
        `store-schemas: no schema registered for store '${store}' — ` +
          "validating structurally ({ id } only). Add it to STORE_SCHEMAS.",
      );
    }
    return PERMISSIVE;
  }
  return schema;
}

/** Parse or throw the typed error API routes translate to a 400.
 *  Tombstones (`_deleted: true` writes) validate as { id } only — a deleted
 *  record's payload may legitimately be empty or legacy-shaped. */
export function validateRecord(
  store: string,
  doc: Record<string, unknown>,
  opts?: { tombstone?: boolean },
): void {
  const schema = opts?.tombstone
    ? z.looseObject({ id: idRuleFor(store) })
    : schemaFor(store);
  const result = schema.safeParse(doc);
  if (!result.success) {
    const recordId = typeof doc.id === "string" ? doc.id : undefined;
    throw new RecordValidationError(store, recordId, result.error.issues);
  }
}
