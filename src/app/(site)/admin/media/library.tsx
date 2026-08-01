"use client";

// The photo library grid — upload, retitle, describe, delete.
//
// UPLOADS RUN ONE REQUEST PER FILE rather than one multipart body with all of
// them. Chamber staff will drag in a folder off a phone or a camera card, and a
// single 12MB HEIC-exported-as-something-odd in a batch of twenty must not sink
// the other nineteen. Per-file requests mean a rejected image reports its own
// filename and everything else still lands. The cost is N round trips, which is
// the right trade for an admin tool used a few times a month.
//
// Plain fetch + local state, matching kiosk-control and the other admin
// consoles rather than introducing a data-fetching library on one page.

import { useRef, useState } from "react";
import { Badge, Callout, Card } from "@/components/ui";
// From lib/media/refs, NOT lib/stores/media-store — the store imports
// fs/promises and must never reach the browser bundle.
import { mediaUrl, type MediaItem } from "@/lib/media/refs";

const btn =
  "rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-60";

type Msg = { kind: "ok" | "error"; text: string } | null;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibrary({ initialItems }: { initialItems: MediaItem[] }) {
  const [items, setItems] = useState<MediaItem[]>(initialItems);
  const [msg, setMsg] = useState<Msg>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Merge one item into local state — replaces by id, else prepends. Keeps a
   *  re-uploaded duplicate from appearing twice, since its id is unchanged. */
  function upsert(item: MediaItem) {
    setItems((prev) => {
      const i = prev.findIndex((p) => p.id === item.id);
      if (i === -1) return [item, ...prev];
      const next = prev.slice();
      next[i] = item;
      return next;
    });
  }

  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("title", file.name.replace(/\.[^.]+$/, ""));
    const res = await fetch("/api/admin/media", { method: "POST", body: fd });
    const data = (await res.json()) as { ok?: boolean; item?: MediaItem; error?: string };
    if (!res.ok || !data.ok || !data.item) return data.error ?? "upload failed";
    upsert(data.item);
    return null;
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setMsg(null);
    const failures: string[] = [];
    let ok = 0;
    try {
      for (const file of files) {
        const err = await uploadOne(file);
        if (err) failures.push(`${file.name}: ${err}`);
        else ok++;
      }
      // Report BOTH halves. "3 of 5 uploaded" with the two failures named is
      // the only honest summary of a partial batch — a bare success count
      // would quietly lose files the user believes they added.
      setMsg(
        failures.length === 0
          ? { kind: "ok", text: `${ok} ${ok === 1 ? "photo" : "photos"} added.` }
          : {
              kind: "error",
              text: `${ok} of ${ok + failures.length} added. Skipped — ${failures.join("; ")}`,
            },
      );
    } catch {
      setMsg({ kind: "error", text: "Upload failed — check your connection and try again." });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveMeta(item: MediaItem, patch: Partial<MediaItem>) {
    const res = await fetch("/api/admin/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Spread the item first so patch wins on the fields being edited, and
      // pin id last so a patch can never retarget the write at another record.
      body: JSON.stringify({ ...item, ...patch, id: item.id }),
    });
    const data = (await res.json()) as { ok?: boolean; item?: MediaItem; error?: string };
    if (!res.ok || !data.ok || !data.item) {
      setMsg({ kind: "error", text: data.error ?? "Could not save those details." });
      return;
    }
    upsert(data.item);
    setEditing(null);
    setMsg({ kind: "ok", text: "Saved." });
  }

  async function remove(item: MediaItem) {
    if (!confirm(`Remove "${item.title}" from the library?`)) return;
    const res = await fetch(`/api/admin/media?id=${encodeURIComponent(item.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setMsg({ kind: "error", text: "Could not remove that photo." });
      return;
    }
    setItems((prev) => prev.filter((p) => p.id !== item.id));
    setMsg({ kind: "ok", text: "Removed from the library." });
  }

  const missingAlt = items.filter((i) => !i.alt.trim()).length;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${btn} cursor-pointer bg-tide-deep text-white`}>
            {uploading ? "Uploading…" : "Add photos"}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <p className="text-sm text-ink-soft">
            JPEG, PNG, WebP or GIF, up to 12MB each. Location data is stripped from every
            upload automatically.
          </p>
        </div>
      </Card>

      {msg && (
        <Callout title={msg.kind === "ok" ? "Done" : "Check this"} tone={msg.kind === "ok" ? "teal" : "coral"}>
          {msg.text}
        </Callout>
      )}

      {missingAlt > 0 && (
        <Callout title="Descriptions needed" tone="coral">
          {/* The whole count phrase lives in ONE expression, and the space that
              follows it is an explicit {" "}. A bare space between `}` and text
              that then wraps onto the next line is swallowed by the JSX
              whitespace rules — it rendered as "photos needa description". */}
          {missingAlt === 1
            ? "1 photo needs a description."
            : `${missingAlt} photos need a description.`}{" "}
          A description is what screen readers announce in place of the image — you&apos;ll
          be asked for one before a photo can go on a page.
        </Callout>
      )}

      {items.length === 0 ? (
        <Card>
          <p className="text-ink-soft">
            No photos yet. Add some above, then you can place them on the home page, the kiosk,
            and business listings.
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                {/* eslint-disable-next-line @next/next/no-img-element -- library
                    thumbnails are admin-only and arbitrary-dimension; next/image
                    would need width/height we do not store. */}
                <img
                  src={mediaUrl(item.id)}
                  alt={item.alt || ""}
                  className="mb-3 h-40 w-full rounded-lg object-cover"
                  loading="lazy"
                />
                {editing === item.id ? (
                  <EditForm
                    item={item}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => saveMeta(item, patch)}
                  />
                ) : (
                  <div className="space-y-2">
                    <p className="font-semibold">{item.title}</p>
                    {item.alt ? (
                      <p className="text-sm text-ink-soft">{item.alt}</p>
                    ) : (
                      <Badge tone="coral">Needs a description</Badge>
                    )}
                    {item.credit && (
                      <p className="text-xs text-ink-soft">Credit: {item.credit}</p>
                    )}
                    <p className="text-xs text-ink-soft">
                      {fmtBytes(item.bytes)} · added {item.addedAt}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        className={`${btn} bg-sand text-ink`}
                        onClick={() => setEditing(item.id)}
                      >
                        Edit details
                      </button>
                      <button
                        type="button"
                        className={`${btn} bg-sand text-ink`}
                        onClick={() => remove(item)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditForm({
  item,
  onSave,
  onCancel,
}: {
  item: MediaItem;
  onSave: (patch: Partial<MediaItem>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [alt, setAlt] = useState(item.alt);
  const [credit, setCredit] = useState(item.credit ?? "");
  const field = "w-full rounded-lg border border-sand px-3 py-2 text-sm";

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, alt, credit });
      }}
    >
      <label className="block text-sm font-semibold">
        Name
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-sm font-semibold">
        Description
        <textarea
          className={field}
          rows={2}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Ferry pulling into the Kingston dock at sunset"
        />
        <span className="block pt-1 text-xs font-normal text-ink-soft">
          Describe what is in the photo, for visitors using a screen reader.
        </span>
      </label>
      <label className="block text-sm font-semibold">
        Credit (optional)
        <input className={field} value={credit} onChange={(e) => setCredit(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={`${btn} bg-tide-deep text-white`}>
          Save
        </button>
        <button type="button" className={`${btn} bg-sand text-ink`} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
