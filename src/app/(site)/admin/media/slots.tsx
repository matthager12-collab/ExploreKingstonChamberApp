"use client";

// "Where photos appear" — the placement half of /admin/media.
//
// Each registered slot shows what visitors see RIGHT NOW, resolved through the
// exact same resolvePhoto() the page uses. That shared call is the point: an
// editor that previewed differently from the live page would be lying, and the
// person using it has no way to check.
//
// Slots are grouped by surface (Home, Sharing, Kiosk) so the list reads like
// the site rather than like a database table.

import { useMemo, useState } from "react";
import { Badge, Callout, Card } from "@/components/ui";
import { isAltStale, resolvePhoto } from "@/lib/photo-resolve";
import { PHOTO_SLOTS, type PhotoSlot, type PhotoSlotKey } from "@/lib/photo-slots";
import { mediaUrl, type MediaItem } from "@/lib/media/refs";

const btn =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-60";

export interface PhotoOverrideView {
  id: string;
  name: string;
  alt?: string;
}

type Ctx = {
  overrides: Record<string, PhotoOverrideView>;
  library: Record<string, MediaItem>;
};

/** Bytes above which a photo in an LCP slot is worth warning about. E15 slice
 *  5c traced a 5.4s Largest Contentful Paint to one oversized image and the
 *  Lighthouse floor was ratcheted afterwards, so the hero is a real budget and
 *  not a style note. next/image still resizes and re-encodes, which is why this
 *  is a warning rather than a refusal. */
const LCP_WARN_BYTES = 900 * 1024;

export function PhotoSlots({ initial }: { initial: Ctx }) {
  const [ctx, setCtx] = useState<Ctx>(initial);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  const items = useMemo(
    () =>
      Object.values(ctx.library).sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1)),
    [ctx.library],
  );

  const groups = useMemo(() => {
    const out = new Map<string, PhotoSlot[]>();
    for (const slot of PHOTO_SLOTS) {
      const list = out.get(slot.page) ?? [];
      list.push(slot);
      out.set(slot.page, list);
    }
    return [...out.entries()];
  }, []);

  async function send(url: string, init: RequestInit, okText: string) {
    setBusy(url);
    setMsg(null);
    try {
      const res = await fetch(url, init);
      const data = (await res.json()) as Partial<Ctx> & { ok?: boolean; error?: string };
      if (!res.ok || !data.ok || !data.overrides || !data.library) {
        setMsg({ kind: "error", text: data.error ?? "That didn't save." });
        return;
      }
      setCtx({ overrides: data.overrides, library: data.library });
      setPicking(null);
      setMsg({ kind: "ok", text: okText });
    } catch {
      setMsg({ kind: "error", text: "That didn't save — check your connection." });
    } finally {
      setBusy(null);
    }
  }

  const place = (slot: string, name: string) =>
    send(
      "/api/admin/photos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, name }),
      },
      "Photo placed.",
    );

  const reset = (slot: string) =>
    send(`/api/admin/photos?slot=${encodeURIComponent(slot)}`, { method: "DELETE" }, "Back to the default photo.");

  const setAlt = (slot: string, name: string, alt: string) =>
    send(
      "/api/admin/photos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, name, alt }),
      },
      "Description saved.",
    );

  if (items.length === 0) {
    return (
      <Card>
        <p className="text-ink-soft">
          Add photos to the library below, then come back here to choose where they appear.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {msg && (
        <Callout title={msg.kind === "ok" ? "Done" : "Check this"} tone={msg.kind === "ok" ? "teal" : "coral"}>
          {msg.text}
        </Callout>
      )}

      {groups.map(([page, slots]) => (
        <section key={page} className="space-y-4">
          <h3 className="font-display text-xl font-semibold">{page}</h3>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {slots.map((slot) => {
              const override = ctx.overrides[slot.key];
              const resolved = resolvePhoto(slot.key as PhotoSlotKey, override, ctx.library);
              const stale = isAltStale(slot.key as PhotoSlotKey, override, ctx.library);
              const placed = override ? ctx.library[override.name] : undefined;
              const heavy = Boolean(slot.lcp && placed && placed.bytes > LCP_WARN_BYTES);

              return (
                <li key={slot.key}>
                  <Card>
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{slot.label}</p>
                          {slot.help && <p className="text-sm text-ink-soft">{slot.help}</p>}
                        </div>
                        {override ? (
                          <Badge tone="teal">Your photo</Badge>
                        ) : (
                          <Badge tone="sand">Default</Badge>
                        )}
                      </div>

                      {/* eslint-disable-next-line @next/next/no-img-element -- admin
                          preview of an arbitrary-dimension photo; next/image
                          would need width/height the library does not store. */}
                      <img
                        src={resolved.src}
                        alt={resolved.alt}
                        style={{ aspectRatio: slot.aspect ?? "4 / 3" }}
                        className="w-full rounded-lg border border-sand object-cover"
                        loading="lazy"
                      />

                      {slot.decorative ? (
                        <p className="text-xs text-ink-soft">
                          Background image — no description needed. It sits behind the
                          headline, which already says what the page is about.
                        </p>
                      ) : (
                        <AltRow
                          resolved={resolved.alt}
                          stale={stale}
                          disabled={!override || busy !== null}
                          onSave={(alt) => override && setAlt(slot.key, override.name, alt)}
                        />
                      )}

                      {heavy && (
                        <p className="text-xs text-coral-deep">
                          This photo is large ({Math.round((placed?.bytes ?? 0) / 1024)} KB) and
                          this spot is the first thing that loads. It will still work, but a
                          smaller file makes the page noticeably faster.
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`${btn} bg-tide-deep text-white`}
                          disabled={busy !== null}
                          onClick={() => setPicking(picking === slot.key ? null : slot.key)}
                        >
                          {picking === slot.key ? "Close" : override ? "Change photo" : "Choose photo"}
                        </button>
                        {override && (
                          <button
                            type="button"
                            className={`${btn} bg-sand text-ink`}
                            disabled={busy !== null}
                            onClick={() => reset(slot.key)}
                          >
                            Use the default
                          </button>
                        )}
                      </div>

                      {picking === slot.key && (
                        <ul className="grid grid-cols-3 gap-2 border-t border-sand pt-3 sm:grid-cols-4">
                          {items.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                className="block w-full text-left"
                                disabled={busy !== null}
                                onClick={() => place(slot.key, item.id)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                                <img
                                  src={mediaUrl(item.id)}
                                  alt=""
                                  className={`h-16 w-full rounded object-cover ${
                                    override?.name === item.id
                                      ? "ring-2 ring-tide-deep"
                                      : "border border-sand"
                                  }`}
                                  loading="lazy"
                                />
                                <span className="mt-1 block truncate text-xs text-ink-soft">
                                  {item.title}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The description row for a content slot.
 *
 * When `stale` is true the slot is falling back to the wording that shipped
 * with the ORIGINAL photo for this position — resolveAlt's documented trade.
 * That fallback is invisible in the rendered page and invisible to axe, so
 * this is the only place it surfaces. Say plainly what is wrong.
 */
function AltRow({
  resolved,
  stale,
  disabled,
  onSave,
}: {
  resolved: string;
  stale: boolean;
  disabled: boolean;
  onSave: (alt: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(resolved);

  if (editing) {
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
          setEditing(false);
        }}
      >
        <textarea
          className="w-full rounded-lg border border-sand px-3 py-2 text-sm"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Description for this spot"
        />
        <div className="flex gap-2">
          <button type="submit" className={`${btn} bg-tide-deep text-white`}>
            Save description
          </button>
          <button type="button" className={`${btn} bg-sand text-ink`} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-1">
      {stale ? (
        <p className="text-xs text-coral-deep">
          This photo has no description, so the site is still reading out the description of
          the photo that used to be here — “{resolved}”. Please describe the new photo.
        </p>
      ) : (
        <p className="text-xs text-ink-soft">Screen readers announce: “{resolved}”</p>
      )}
      <button
        type="button"
        className="text-xs font-semibold underline disabled:no-underline disabled:opacity-60"
        disabled={disabled}
        onClick={() => {
          setDraft(resolved);
          setEditing(true);
        }}
      >
        {stale ? "Describe this photo" : "Change the description for this spot"}
      </button>
    </div>
  );
}
