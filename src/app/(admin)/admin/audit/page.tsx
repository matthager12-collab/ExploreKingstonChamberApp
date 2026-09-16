// /admin/audit — the global audit browser (E09; FR-A05): every change to
// every record, filterable, cursor-paginated, CSV-exportable, immutable from
// this UI by construction (the page only ever reads). The /admin layout
// gates access; the API routes it calls re-check admin themselves.
//
// Deep links matter here: /admin/audit?store=map-features&recordId=… is how
// the frozen map editors' content gets history + restore without touching
// the monoliths — with store AND recordId pinned, the browser shows the
// record's provenance and per-row restore.

import { PageHeader, Section } from "@/components/ui";
import { auditStoreNames } from "@/lib/audit/read";

import { AuditBrowser } from "./browser";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const str = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const stores = await auditStoreNames();

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Admin"
        title="Change history"
        intro="Every edit, in plain language. Nothing here can be edited or deleted — the trail is append-only, and restoring an old version is itself recorded as a new change."
      />
      <Section>
        <AuditBrowser
          stores={stores}
          initialFilters={{
            store: str(params.store),
            recordId: str(params.recordId),
            actor: str(params.actor),
            action: str(params.action),
            from: str(params.from),
            to: str(params.to),
          }}
        />
      </Section>
    </div>
  );
}
