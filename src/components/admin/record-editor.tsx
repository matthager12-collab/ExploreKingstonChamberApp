"use client";

// The shared schema-driven record editor (E07, vk/editor-engine): list, tabs,
// and form generalized from the listings workbench. Each domain hands in a
// DomainDef — field list for the UI plus the zod schema the API route also
// validates with — and the form, validation, and save payload all come from
// that one definition.
//
// Saves go through /api/admin/content-records, the same overlay-backed API
// the itinerary builder uses.
//
// Deleting works on any record: custom records disappear outright, and seed
// records get a tombstone overlay that hides them from the site (restorable
// later by removing the overlay row) — the confirm dialog explains which.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DomainDef, FieldDef, GenericRecord } from "@/lib/schemas/form";
import { Badge, Card } from "@/components/ui";

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

/* --------------------------------- helpers -------------------------------- */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Record field → editable string/boolean per the field kind. */
function toDraftValue(field: FieldDef, value: unknown): string | boolean {
  if (field.kind === "checkbox") return Boolean(value);
  if (field.kind === "csv-tags") {
    return Array.isArray(value) ? (value as unknown[]).map(String).join(", ") : "";
  }
  if (value == null) return field.defaultValue ?? "";
  return String(value);
}

type Draft = {
  domain: string;
  id: string;
  idTouched: boolean;
  isNew: boolean;
  values: Record<string, string | boolean>;
};

function recordToDraft(domain: DomainDef, record: GenericRecord): Draft {
  const values: Record<string, string | boolean> = {};
  for (const f of domain.fields) values[f.key] = toDraftValue(f, record[f.key]);
  return { domain: domain.key, id: record.id, idTouched: true, isNew: false, values };
}

function newRecordDraft(domain: DomainDef): Draft {
  const values: Record<string, string | boolean> = {};
  for (const f of domain.fields) {
    values[f.key] = f.kind === "checkbox" ? false : (f.defaultValue ?? "");
  }
  return { domain: domain.key, id: "", idTouched: false, isNew: true, values };
}

/** Draft → validated record via the domain schema. Returns the parsed record
 *  (canonical: trimmed strings, coerced numbers, empty optionals omitted) or
 *  an error message. The schema is the same object the API route parses with,
 *  so the form now surfaces every server rule — numeric ranges included —
 *  before the round-trip. */
function buildRecord(domain: DomainDef, draft: Draft): GenericRecord | string {
  const id = draft.id.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) {
    return "Id is required: letters, numbers, and dashes (e.g. point-casino-hotel).";
  }
  const record: GenericRecord = { id };
  for (const f of domain.fields) {
    const raw = draft.values[f.key];
    if (f.kind === "checkbox") {
      record[f.key] = Boolean(raw);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (f.kind === "csv-tags") {
      record[f.key] = text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (f.kind === "number") {
      // Pass the text through only when present — the schema coerces numeric
      // strings; an empty required number then fails with its range message.
      if (text !== "") record[f.key] = text;
    } else {
      record[f.key] = text;
    }
  }
  const parsed = domain.schema.safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const fieldKey = typeof issue?.path[0] === "string" ? issue.path[0] : "";
    const field = domain.fields.find((f) => f.key === fieldKey);
    const message = issue?.message ?? `Could not validate the ${domain.noun}.`;
    return field ? `${field.label}: ${message}` : message;
  }
  return parsed.data as GenericRecord;
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink">{label}</span>
      <span className="mt-1 block">{children}</span>
      {help && <span className="mt-1 block text-xs text-ink-soft">{help}</span>}
    </label>
  );
}

/* --------------------------------- editor --------------------------------- */

export function RecordEditor({
  domains,
  initial,
  seedIds,
}: {
  domains: DomainDef[];
  initial: Record<string, GenericRecord[]>;
  seedIds: Record<string, string[]>;
}) {
  const router = useRouter();
  const [records, setRecords] = useState<Record<string, GenericRecord[]>>(() =>
    Object.fromEntries(domains.map((d) => [d.key, initial[d.key] ?? []])),
  );
  const [activeKey, setActiveKey] = useState<string>(domains[0].key);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const domain = domains.find((d) => d.key === activeKey)!;
  const list = records[activeKey];
  const isSeed = (id: string) => (seedIds[activeKey] ?? []).includes(id);

  function switchDomain(key: string) {
    setActiveKey(key);
    setDraft(null);
    setMessage(null);
  }

  function edit(record: GenericRecord) {
    setDraft(recordToDraft(domain, record));
    setMessage(null);
  }

  function startNew() {
    setDraft(newRecordDraft(domain));
    setMessage(null);
  }

  function patchValue(key: string, value: string | boolean) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, values: { ...d.values, [key]: value } };
      // Auto-suggest the id from the name for new records until id is hand-edited.
      if (key === "name" && d.isNew && !d.idTouched && typeof value === "string") {
        next.id = slugify(value);
      }
      return next;
    });
  }

  async function save(current: Draft) {
    const built = buildRecord(domain, current);
    if (typeof built === "string") {
      setMessage({ kind: "error", text: built });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/content-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.key, record: built }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        record?: GenericRecord;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.record) {
        setMessage({ kind: "error", text: data.error ?? `Could not save the ${domain.noun}.` });
        return;
      }
      const saved = data.record;
      setRecords((all) => {
        const listNow = all[domain.key];
        const idx = listNow.findIndex((r) => r.id === saved.id);
        const nextList =
          idx >= 0 ? listNow.map((r, n) => (n === idx ? saved : r)) : [...listNow, saved];
        return { ...all, [domain.key]: nextList };
      });
      setDraft(recordToDraft(domain, saved));
      setMessage({ kind: "ok", text: `Saved — live on ${domain.publicPath}` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(current: Draft) {
    if (!current.id || current.isNew) return;
    const name = String(current.values.name || current.id);
    const confirmText = isSeed(current.id)
      ? `"${name}" is a built-in ${domain.noun}. Deleting writes a tombstone that hides it from the site — it isn't gone forever (an admin/developer can restore it by removing the overlay row). Hide it?`
      : `Delete "${name}"? It disappears from the site immediately.`;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/content-records?domain=${domain.key}&id=${encodeURIComponent(current.id)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage({
          kind: "error",
          text: data.error ?? `Could not delete the ${domain.noun}.`,
        });
        return;
      }
      setRecords((all) => ({
        ...all,
        [domain.key]: all[domain.key].filter((r) => r.id !== current.id),
      }));
      setDraft(null);
      setMessage({ kind: "ok", text: `Deleted "${name}".` });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — try again." });
    } finally {
      setBusy(false);
    }
  }

  function renderInput(f: FieldDef) {
    const raw = draft?.values[f.key];
    if (f.kind === "checkbox") {
      return (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={Boolean(raw)}
            onChange={(e) => patchValue(f.key, e.target.checked)}
          />
          {f.label}
        </label>
      );
    }
    const value = typeof raw === "string" ? raw : "";
    if (f.kind === "textarea") {
      return (
        <textarea
          className={INPUT}
          rows={3}
          value={value}
          placeholder={f.placeholder}
          onChange={(e) => patchValue(f.key, e.target.value)}
        />
      );
    }
    if (f.kind === "select") {
      return (
        <select
          className={INPUT}
          value={value}
          onChange={(e) => patchValue(f.key, e.target.value)}
        >
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className={INPUT}
        inputMode={f.kind === "number" ? "decimal" : undefined}
        value={value}
        placeholder={f.placeholder}
        onChange={(e) => patchValue(f.key, e.target.value)}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Domain tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {domains.map((d) => (
          <button
            key={d.key}
            onClick={() => switchDomain(d.key)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
              activeKey === d.key
                ? "border-sound bg-sound text-white"
                : "border-sand bg-white text-ink hover:border-tide"
            }`}
          >
            {d.label}
            <span className="ml-1.5 text-xs font-normal opacity-70">
              {records[d.key].length}
            </span>
          </button>
        ))}
      </div>

      {/* Record list */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            {list.length} {domain.label.toLowerCase()} record{list.length === 1 ? "" : "s"} —
            live on{" "}
            <a
              href={domain.publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              {domain.publicPath}
            </a>
          </p>
          <button
            onClick={startNew}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${
              draft?.isNew
                ? "border-coral bg-coral text-white"
                : "border-coral bg-white text-coral-deep hover:bg-coral/10"
            }`}
          >
            + New {domain.noun}
          </button>
        </div>
        <ul className="mt-3 divide-y divide-sand">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <button
                onClick={() => edit(r)}
                className={`text-left text-sm font-semibold ${
                  draft?.id === r.id && !draft.isNew
                    ? "text-tide-deep underline decoration-seaglass underline-offset-2"
                    : "text-sound-deep hover:text-tide-deep"
                }`}
              >
                {String(r.name ?? r.id)}
              </button>
              <Badge tone={isSeed(r.id) ? "navy" : "coral"}>
                {isSeed(r.id) ? "Seed" : "Custom"}
              </Badge>
              {Boolean(r.hidden) && <Badge tone="sand">Hidden</Badge>}
              <span className="text-xs text-ink-soft">{r.id}</span>
              <button
                onClick={() => edit(r)}
                className="ml-auto rounded-full border border-sand bg-white px-3 py-1 text-xs font-semibold text-ink hover:border-tide"
              >
                Edit
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-2.5 text-sm text-ink-soft">No records yet.</li>
          )}
        </ul>
      </Card>

      {/* Edit form */}
      {draft && draft.domain === domain.key && (
        <Card>
          <p className="font-semibold text-sound-deep">
            {draft.isNew
              ? `New ${domain.noun}`
              : `Editing: ${String(draft.values.name || draft.id)}`}
            {!draft.isNew && isSeed(draft.id) && (
              <span className="ml-2 align-middle">
                <Badge tone="navy">Seed — saving stores a custom copy that overrides it</Badge>
              </span>
            )}
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label="Id"
              help={
                draft.isNew
                  ? "Auto-suggested from the name; lowercase letters, numbers, dashes. Fixed after the first save."
                  : "Ids can't change — the overlay matches records by id."
              }
            >
              <input
                className={`${INPUT} ${draft.isNew ? "" : "bg-shell text-ink-soft"}`}
                value={draft.id}
                readOnly={!draft.isNew}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, id: e.target.value, idTouched: true } : d))
                }
              />
            </Field>
            {domain.fields.map((f) =>
              f.kind === "checkbox" ? (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                  {renderInput(f)}
                  {f.help && <p className="mt-1 text-xs text-ink-soft">{f.help}</p>}
                </div>
              ) : (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                  <Field label={f.label} help={f.help}>
                    {renderInput(f)}
                  </Field>
                </div>
              ),
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void save(draft)}
              disabled={busy}
              className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep disabled:opacity-60"
            >
              {busy ? "Working…" : `Save ${domain.noun}`}
            </button>
            {!draft.isNew && (
              <button
                onClick={() => void remove(draft)}
                disabled={busy}
                className="rounded-full border border-coral/40 bg-white px-4 py-2 text-sm font-semibold text-coral-deep hover:bg-coral/10 disabled:opacity-60"
              >
                {isSeed(draft.id) ? "Hide (delete seed)" : "Delete"}
              </button>
            )}
            <button
              onClick={() => {
                setDraft(null);
                setMessage(null);
              }}
              disabled={busy}
              className="rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-tide disabled:opacity-60"
            >
              Close
            </button>
            {message && (
              <p
                className={`text-sm font-medium ${
                  message.kind === "ok" ? "text-fern" : "text-coral-deep"
                }`}
              >
                {message.text}
              </p>
            )}
          </div>
        </Card>
      )}

      {!draft && message && (
        <p
          className={`text-sm font-medium ${
            message.kind === "ok" ? "text-fern" : "text-coral-deep"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
