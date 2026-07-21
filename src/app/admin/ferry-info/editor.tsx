"use client";

// Client half of /admin/ferry-info: a field-level editor for the four ferry
// FACT records (payment, boarding-pass, cash-tips, sources). Deliberately plain
// (fetch + local state), in the same spirit as admin/content/manager.tsx. All
// authorization is server-side — this UI talks to /api/admin/ferry-info, which
// requires role admin and rebuilds each doc from known fields.
//
// Each record is edited as a live draft and saved as a whole doc for its id.
// The machine-down note (boarding-pass.currentNote) is surfaced at the very top
// because it changes most often; it edits the same boarding-pass draft, so
// saving either place persists it.

import { useState } from "react";
import type {
  BoardingPass,
  FerryInfo,
  FerryPayment,
  Source,
} from "@/lib/data/ferry-info";
import { Badge, Card } from "@/components/ui";
import { Provenance } from "@/components/admin/provenance";
import { RecordHistory } from "@/components/admin/record-history";

/* --------------------------------- styles --------------------------------- */

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const ghostButtonClass =
  "rounded-full border border-sand bg-white px-4 py-2 text-sm font-semibold text-tide-deep hover:border-tide disabled:opacity-50";
const smallGhost =
  "rounded-full border border-sand bg-white px-3 py-1 text-xs font-semibold text-tide-deep hover:border-tide disabled:opacity-50";

/* ------------------------------- API helper ------------------------------- */

type RecordId = "payment" | "boarding-pass" | "cash-tips" | "sources";

async function saveRecord(id: RecordId, doc: unknown): Promise<string | null> {
  try {
    const res = await fetch("/api/admin/ferry-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, doc }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? "Something went wrong";
  } catch {
    return "Network error — try again";
  }
}

/* ----------------------------- field building blocks ---------------------- */

function TextField({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-ink">{label}</label>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={4000}
        className={inputClass}
      />
    </div>
  );
}

/** Editable string list: reorder-free, add/remove/edit rows. */
function StringListEditor({
  label,
  items,
  onChange,
  placeholder = "Add a line…",
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const set = (i: number, v: string) => {
    const next = items.slice();
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="mt-1 space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              value={item}
              onChange={(e) => set(i, e.target.value)}
              rows={2}
              maxLength={4000}
              className="block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base"
            />
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className={smallGhost}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                aria-label="Move down"
                className={smallGhost}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove line"
                className="rounded-full border border-coral/40 bg-coral/5 px-3 py-1 text-xs font-semibold text-coral-deep hover:bg-coral/10"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className={`mt-2 ${ghostButtonClass}`}>
        + {placeholder}
      </button>
    </div>
  );
}

/** Editable list of {label, url} sources. */
function SourcesEditor({
  items,
  onChange,
}: {
  items: Source[];
  onChange: (next: Source[]) => void;
}) {
  const set = (i: number, patch: Partial<Source>) => {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { label: "", url: "" }]);

  return (
    <div>
      <p className="text-sm font-medium text-ink">Sources</p>
      <p className="text-xs text-ink-soft">
        Label plus an https link — shown as the citations for these facts.
      </p>
      <div className="mt-1 space-y-3">
        {items.map((src, i) => (
          <div key={i} className="rounded-lg border border-sand p-3">
            <label className="text-xs font-medium text-ink">Label</label>
            <input
              value={src.label}
              onChange={(e) => set(i, { label: e.target.value })}
              maxLength={300}
              className={inputClass}
            />
            <label className="mt-2 block text-xs font-medium text-ink">URL</label>
            <input
              value={src.url}
              onChange={(e) => set(i, { url: e.target.value })}
              maxLength={600}
              placeholder="https://…"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-2 rounded-full border border-coral/40 bg-coral/5 px-3 py-1 text-xs font-semibold text-coral-deep hover:bg-coral/10"
            >
              Remove source
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className={`mt-2 ${ghostButtonClass}`}>
        + Add source
      </button>
    </div>
  );
}

/** Save/Reset row shared by every record group. */
function SaveBar({
  busy,
  saved,
  error,
  onSave,
  onReset,
}: {
  busy: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-coral-deep">{error}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sand pt-4">
        <button type="button" onClick={onSave} disabled={busy} className={buttonClass}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className={ghostButtonClass}
        >
          Revert edits
        </button>
        {saved && <Badge tone="green">Saved</Badge>}
      </div>
    </>
  );
}

/* --------------------------------- editor --------------------------------- */

export function FerryInfoEditor({ initial }: { initial: FerryInfo }) {
  // One draft per record. `initial` is the merged (overlay-or-seed) value.
  const [payment, setPayment] = useState<FerryPayment>(() => ({
    ...initial.payment,
    methods: [...initial.payment.methods],
  }));
  const [boarding, setBoarding] = useState<BoardingPass>(() => ({
    ...initial.boardingPass,
    how: [...initial.boardingPass.how],
  }));
  const [cashTips, setCashTips] = useState<string[]>(() => [...initial.cashTips]);
  const [sources, setSources] = useState<Source[]>(() =>
    initial.sources.map((s) => ({ ...s })),
  );

  // Per-record UI state.
  const [busy, setBusy] = useState<Record<RecordId, boolean>>({
    payment: false,
    "boarding-pass": false,
    "cash-tips": false,
    sources: false,
  });
  const [saved, setSaved] = useState<Record<RecordId, boolean>>({
    payment: false,
    "boarding-pass": false,
    "cash-tips": false,
    sources: false,
  });
  const [errors, setErrors] = useState<Record<RecordId, string | null>>({
    payment: null,
    "boarding-pass": null,
    "cash-tips": null,
    sources: null,
  });

  async function commit(id: RecordId, doc: unknown) {
    setBusy((p) => ({ ...p, [id]: true }));
    setErrors((p) => ({ ...p, [id]: null }));
    const failure = await saveRecord(id, doc);
    setBusy((p) => ({ ...p, [id]: false }));
    if (failure) {
      setErrors((p) => ({ ...p, [id]: failure }));
      return;
    }
    setSaved((p) => ({ ...p, [id]: true }));
    setTimeout(() => setSaved((p) => ({ ...p, [id]: false })), 1800);
  }

  function reset(id: RecordId) {
    if (id === "payment")
      setPayment({ ...initial.payment, methods: [...initial.payment.methods] });
    else if (id === "boarding-pass")
      setBoarding({ ...initial.boardingPass, how: [...initial.boardingPass.how] });
    else if (id === "cash-tips") setCashTips([...initial.cashTips]);
    else setSources(initial.sources.map((s) => ({ ...s })));
    setErrors((p) => ({ ...p, [id]: null }));
  }

  return (
    <div className="space-y-5">
      {/* Machine-down note first — it changes most often. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-lg font-semibold text-sound-deep">
            Machine-down note
          </p>
          <Badge tone="coral">changes often</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          The temporary “current note” under the boarding-pass section — e.g. the
          dispenser is down and officers are handing passes out by hand. Clear it
          when the machine is back. (Saves as part of the boarding-pass record.)
        </p>
        <div className="mt-3">
          <TextField
            label="Current note"
            value={boarding.currentNote}
            onChange={(v) => setBoarding((b) => ({ ...b, currentNote: v }))}
            rows={3}
          />
        </div>
        <SaveBar
          busy={busy["boarding-pass"]}
          saved={saved["boarding-pass"]}
          error={errors["boarding-pass"]}
          onSave={() => commit("boarding-pass", boarding)}
          onReset={() => reset("boarding-pass")}
        />
      </Card>

      {/* Payment */}
      <Card>
        <p className="font-display text-lg font-semibold text-sound-deep">
          Paying for the ferry
        </p>
        <div className="mt-3 space-y-4">
          <StringListEditor
            label="Payment methods"
            items={payment.methods}
            onChange={(methods) => setPayment((p) => ({ ...p, methods }))}
            placeholder="Add a payment method"
          />
          <TextField
            label="Kiosk note"
            value={payment.kioskNote}
            onChange={(v) => setPayment((p) => ({ ...p, kioskNote: v }))}
            rows={2}
          />
          <TextField
            label="Cash note"
            value={payment.cashNote}
            onChange={(v) => setPayment((p) => ({ ...p, cashNote: v }))}
            rows={2}
          />
          <TextField
            label="Card surcharge note"
            value={payment.surchargeNote}
            onChange={(v) => setPayment((p) => ({ ...p, surchargeNote: v }))}
            rows={3}
          />
          <TextField
            label="Free-leg note (walking on from Kingston)"
            value={payment.freeLegNote}
            onChange={(v) => setPayment((p) => ({ ...p, freeLegNote: v }))}
            rows={3}
          />
        </div>
        <SaveBar
          busy={busy.payment}
          saved={saved.payment}
          error={errors.payment}
          onSave={() => commit("payment", payment)}
          onReset={() => reset("payment")}
        />
      </Card>

      {/* Boarding pass */}
      <Card>
        <p className="font-display text-lg font-semibold text-sound-deep">
          Vehicle boarding pass
        </p>
        <div className="mt-3 space-y-4">
          <TextField
            label="Summary"
            value={boarding.summary}
            onChange={(v) => setBoarding((b) => ({ ...b, summary: v }))}
            rows={3}
          />
          <TextField
            label="When it's required"
            value={boarding.whenRequired}
            onChange={(v) => setBoarding((b) => ({ ...b, whenRequired: v }))}
            rows={4}
          />
          <TextField
            label="Where (dispenser + advisory sign)"
            value={boarding.where}
            onChange={(v) => setBoarding((b) => ({ ...b, where: v }))}
            rows={3}
          />
          <StringListEditor
            label="How it works (steps)"
            items={boarding.how}
            onChange={(how) => setBoarding((b) => ({ ...b, how }))}
            placeholder="Add a step"
          />
          <TextField
            label="Voids (leaving the line)"
            value={boarding.voids}
            onChange={(v) => setBoarding((b) => ({ ...b, voids: v }))}
            rows={3}
          />
          <TextField
            label="Who's exempt"
            value={boarding.exempt}
            onChange={(v) => setBoarding((b) => ({ ...b, exempt: v }))}
            rows={2}
          />
          <TextField
            label="Current note (machine-down — also editable up top)"
            value={boarding.currentNote}
            onChange={(v) => setBoarding((b) => ({ ...b, currentNote: v }))}
            rows={3}
          />
        </div>
        <SaveBar
          busy={busy["boarding-pass"]}
          saved={saved["boarding-pass"]}
          error={errors["boarding-pass"]}
          onSave={() => commit("boarding-pass", boarding)}
          onReset={() => reset("boarding-pass")}
        />
      </Card>

      {/* Cash tips */}
      <Card>
        <p className="font-display text-lg font-semibold text-sound-deep">
          Cash tips
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Quick, scannable dock tips — no ATM at the dock, ORCA beats the
          surcharge, and so on.
        </p>
        <div className="mt-3">
          <StringListEditor
            label="Tips"
            items={cashTips}
            onChange={setCashTips}
            placeholder="Add a tip"
          />
        </div>
        <SaveBar
          busy={busy["cash-tips"]}
          saved={saved["cash-tips"]}
          error={errors["cash-tips"]}
          onSave={() => commit("cash-tips", cashTips)}
          onReset={() => reset("cash-tips")}
        />
      </Card>

      {/* Sources */}
      <Card>
        <p className="font-display text-lg font-semibold text-sound-deep">
          Sources
        </p>
        <div className="mt-3">
          <SourcesEditor items={sources} onChange={setSources} />
        </div>
        <SaveBar
          busy={busy.sources}
          saved={saved.sources}
          error={errors.sources}
          onSave={() => commit("sources", sources)}
          onReset={() => reset("sources")}
        />
      </Card>

      {/* E09: each ferry-info card is a fixed record — its provenance and
          change history mount here rather than per-card, keeping the editing
          cards uncluttered. */}
      <Card>
        <p className="font-display text-lg font-semibold text-sound-deep">
          Change history
        </p>
        <div className="mt-3 space-y-4">
          {(
            [
              ["payment", "Payment"],
              ["boarding-pass", "Boarding pass"],
              ["cash-tips", "Cash & tips"],
              ["sources", "Sources"],
            ] as const
          ).map(([id, label]) => (
            <div key={id} className="space-y-2">
              <p className="text-sm font-medium text-ink">{label}</p>
              <Provenance store="ferry-info" recordId={id} />
              <RecordHistory store="ferry-info" recordId={id} />
            </div>
          ))}
        </div>
      </Card>

      <p className="text-sm text-ink-soft">Public pages update within a minute.</p>
    </div>
  );
}
