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
import { Provenance } from "@/components/admin/provenance";
import { RecordHistory } from "@/components/admin/record-history";

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

/** The id control is synthesised by the editor rather than declared by the
 *  domain, so it needs a reserved key for the id/aria-describedby plumbing. */
const ID_FIELD_KEY = "id";

type BuildResult =
  | { ok: true; record: GenericRecord }
  /** `fieldKey` is "" when the failure can't be pinned to one control. */
  | { ok: false; fieldKey: string; text: string };

/** Draft → validated record via the domain schema. Returns the parsed record
 *  (canonical: trimmed strings, coerced numbers, empty optionals omitted) or
 *  the offending field plus its message. The schema is the same object the API
 *  route parses with, so the form now surfaces every server rule — numeric
 *  ranges included — before the round-trip.
 *
 *  E14: the failure keeps its `fieldKey` instead of collapsing to a flat
 *  string, so the editor can mark that control `aria-invalid`, describe it with
 *  the message, and move focus there. */
function buildRecord(domain: DomainDef, draft: Draft): BuildResult {
  const id = draft.id.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) {
    return {
      ok: false,
      fieldKey: ID_FIELD_KEY,
      text: "Id is required: letters, numbers, and dashes (e.g. point-casino-hotel).",
    };
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
    return {
      ok: false,
      fieldKey: field ? fieldKey : "",
      text: field ? `${field.label}: ${message}` : message,
    };
  }
  return { ok: true, record: parsed.data as GenericRecord };
}

/** E14: explicit `htmlFor`/`id` association. Help and error text sit OUTSIDE
 *  the `<label>` and reach the control through `aria-describedby` — nested in
 *  the label they were concatenated into the control's accessible name, so the
 *  Id field announced as "Id Auto-suggested from the name; lowercase…". */
function Field({
  id,
  label,
  help,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="text-sm">
      <label htmlFor={id} className="block font-medium text-ink">
        {label}
        {/* The required state is carried programmatically by `required` /
            `aria-required` on the control; the marker is its visual echo. */}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
      {help && (
        <p id={`${id}-help`} className="mt-1 text-xs text-ink-soft">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-coral-deep">
          {error}
        </p>
      )}
    </div>
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
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
    /** set when the failure belongs to one control (E14) */
    fieldKey?: string;
  } | null>(null);

  const domain = domains.find((d) => d.key === activeKey)!;
  const list = records[activeKey];
  const isSeed = (id: string) => (seedIds[activeKey] ?? []).includes(id);
  /** Stable DOM id per control — the anchor for htmlFor / aria-describedby. */
  const fieldId = (key: string) => `record-editor-${domain.key}-${key}`;
  const errorFor = (key: string) =>
    message?.kind === "error" && message.fieldKey === key ? message.text : undefined;

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
    if (!built.ok) {
      setMessage({ kind: "error", text: built.text, fieldKey: built.fieldKey });
      // Announce and land: the message is a live region, and focus follows it
      // to the control that failed rather than sitting on the Save button.
      const failed = built.fieldKey;
      if (failed) {
        requestAnimationFrame(() => document.getElementById(fieldId(failed))?.focus());
      }
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/content-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.key, record: built.record }),
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
    const id = fieldId(f.key);
    const invalid = Boolean(errorFor(f.key));
    // One describedby chain per control: help first, then the error, so AT
    // reads the guidance and the reason the save failed (E14).
    const describedBy =
      [f.help ? `${id}-help` : null, invalid ? `${id}-error` : null].filter(Boolean).join(" ") ||
      undefined;
    const aria = {
      id,
      required: f.required,
      "aria-required": f.required || undefined,
      "aria-invalid": invalid || undefined,
      "aria-describedby": describedBy,
    } as const;

    if (f.kind === "checkbox") {
      return (
        <div className="text-sm">
          <label htmlFor={id} className="flex items-center gap-2 text-ink">
            <input
              {...aria}
              type="checkbox"
              checked={Boolean(raw)}
              onChange={(e) => patchValue(f.key, e.target.checked)}
            />
            {f.label}
          </label>
          {f.help && (
            <p id={`${id}-help`} className="mt-1 text-xs text-ink-soft">
              {f.help}
            </p>
          )}
          {invalid && (
            <p id={`${id}-error`} className="mt-1 text-xs font-medium text-coral-deep">
              {errorFor(f.key)}
            </p>
          )}
        </div>
      );
    }
    const value = typeof raw === "string" ? raw : "";
    if (f.kind === "textarea") {
      return (
        <textarea
          {...aria}
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
          {...aria}
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
        {...aria}
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
            type="button"
            onClick={startNew}
            aria-pressed={Boolean(draft?.isNew)}
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
                type="button"
                onClick={() => edit(r)}
                // Colour + underline marked the open record; `aria-current` is
                // the half AT could not see (M-14-04).
                aria-current={draft?.id === r.id && !draft.isNew ? "true" : undefined}
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

          {/* E09: where this record came from + who touched it last. Keyed
              so switching records remounts (see record-history.tsx). */}
          {!draft.isNew && (
            <div className="mt-2">
              <Provenance
                key={`${domain.key}:${draft.id}`}
                store={domain.key}
                recordId={draft.id}
              />
            </div>
          )}

          {/* E14: a real <form>, so Enter submits from any text field and every
              action button declares its type. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(draft);
            }}
          >
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {domain.fields.some((f) => f.required) && (
                <p className="text-xs text-ink-soft sm:col-span-2">Fields marked * are required.</p>
              )}
              <Field
                id={fieldId(ID_FIELD_KEY)}
                label="Id"
                required
                error={errorFor(ID_FIELD_KEY)}
                help={
                  draft.isNew
                    ? "Auto-suggested from the name; lowercase letters, numbers, dashes. Fixed after the first save."
                    : "Ids can't change — the overlay matches records by id."
                }
              >
                <input
                  id={fieldId(ID_FIELD_KEY)}
                  required
                  aria-required="true"
                  aria-invalid={errorFor(ID_FIELD_KEY) ? true : undefined}
                  aria-describedby={
                    errorFor(ID_FIELD_KEY)
                      ? `${fieldId(ID_FIELD_KEY)}-help ${fieldId(ID_FIELD_KEY)}-error`
                      : `${fieldId(ID_FIELD_KEY)}-help`
                  }
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
                  // renderInput owns the checkbox's own label, help and error
                  // wiring — the help <p> used to sit out here, unassociated.
                  <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                    {renderInput(f)}
                  </div>
                ) : (
                  <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                    <Field
                      id={fieldId(f.key)}
                      label={f.label}
                      help={f.help}
                      required={f.required}
                      error={errorFor(f.key)}
                    >
                      {renderInput(f)}
                    </Field>
                  </div>
                ),
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep disabled:opacity-60"
              >
                {busy ? "Working…" : `Save ${domain.noun}`}
              </button>
              {!draft.isNew && (
                <button
                  type="button"
                  onClick={() => void remove(draft)}
                  disabled={busy}
                  className="rounded-full border border-coral/40 bg-white px-4 py-2 text-sm font-semibold text-coral-deep hover:bg-coral/10 disabled:opacity-60"
                >
                  {isSeed(draft.id) ? "Hide (delete seed)" : "Delete"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setMessage(null);
                }}
                disabled={busy}
                className="rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-tide disabled:opacity-60"
              >
                Close
              </button>
              {/* Always mounted so the announcement fires when the text
                  arrives; sr-only while empty keeps the row's gap honest. */}
              <p
                role="status"
                aria-live="polite"
                className={
                  message
                    ? `text-sm font-medium ${message.kind === "ok" ? "text-fern" : "text-coral-deep"}`
                    : "sr-only"
                }
              >
                {message?.text}
              </p>
            </div>
          </form>

          {/* E09: fearless undo — every change to this record, restorable. */}
          {!draft.isNew && (
            <div className="mt-4">
              <RecordHistory
                key={`${domain.key}:${draft.id}`}
                store={domain.key}
                recordId={draft.id}
              />
            </div>
          )}
        </Card>
      )}

      {!draft && (
        <p
          role="status"
          aria-live="polite"
          className={
            message
              ? `text-sm font-medium ${message.kind === "ok" ? "text-fern" : "text-coral-deep"}`
              : "sr-only"
          }
        >
          {message?.text}
        </p>
      )}
    </div>
  );
}
