"use client";

// "Your events page": the member saves one url, we suggest events from it as
// DRAFTS, and nothing publishes until they press Publish. Publish goes through
// the normal POST /api/portal/events, so the moderation floor applies unchanged
// (docs/adr/ADR-0009). All text is rendered as React text.

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, FormSection, TextField } from "@/components/portal/form";
import { PENDING_TEXT } from "@/components/portal/business-save";
import { describeRepeat, rruleToPreset } from "@/lib/events/recurrence";
import { fmtEventDate } from "./events-form";

export interface PanelPage {
  url: string;
  lastCheckedAt: string | null;
  lastError: string | null;
}
export interface PanelDraft {
  id: string;
  title: string;
  start: string;
  end: string | null;
  venue: string | null;
  description: string;
  category: string;
  rrule: string | null;
  ticketUrl: string | null;
  timeMissing: boolean;
}

type Api = {
  error?: string;
  page?: PanelPage | null;
  drafts?: PanelDraft[];
  found?: number;
  added?: number;
};

const ENDPOINT = "/api/portal/event-page";

/** Model-derived, so only a plain web link ever becomes an href. */
function webLink(u: string | null): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

/** "17:30" -> "5:30 pm", matching fmtEventDate's style. */
function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${h >= 12 ? "pm" : "am"}`;
}

/** Series: "Every week on Friday · 6:30 pm". One-off: "Fri, Nov 13 · 6:30 pm". */
function whenText(d: PanelDraft): string {
  const time = d.timeMissing ? "" : ` · ${fmtTime(d.start.slice(11, 16))}`;
  if (d.rrule) {
    const preset = rruleToPreset(d.rrule);
    return `${preset ? describeRepeat(preset) : "Repeats"}${time}`;
  }
  return d.timeMissing ? fmtEventDate(d.start).split(" · ")[0] : fmtEventDate(d.start);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function EventPagePanel({
  ownerId,
  organizer,
  initialPage,
  initialDrafts,
}: {
  ownerId: string;
  organizer: string;
  initialPage: PanelPage | null;
  initialDrafts: PanelDraft[];
}) {
  const router = useRouter();
  const [page, setPage] = useState<PanelPage | null>(initialPage);
  const [drafts, setDrafts] = useState<PanelDraft[]>(initialDrafts);
  const [url, setUrl] = useState(initialPage?.url ?? "");
  const [times, setTimes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(method: string, body: Record<string, unknown>): Promise<Api> {
    const res = await fetch(ENDPOINT, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as Api;
    if (!res.ok) throw new Error(data.error ?? "Something went wrong — try again");
    return data;
  }

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Something went wrong — try again",
      });
    } finally {
      setBusy(null);
    }
  }

  function apply(data: Api) {
    if (data.page !== undefined) setPage(data.page);
    if (data.drafts) setDrafts(data.drafts);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run("save", async () => {
      const data = await call("PUT", { url: url.trim() });
      apply(data);
      return data.page ? "Saved. Press Check now to look for events." : "Link removed.";
    });
  }

  function check() {
    void run("check", async () => {
      const data = await call("POST", { action: "check" });
      apply(data);
      if (data.error) throw new Error(data.error);
      return `Found ${plural(data.found ?? 0, "event")}, ${data.added ?? 0} new`;
    });
  }

  function dismiss(d: PanelDraft) {
    void run(`d-${d.id}`, async () => {
      await call("POST", { action: "dismiss", draftId: d.id });
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
      return `Dismissed "${d.title}".`;
    });
  }

  function publish(d: PanelDraft) {
    const time = times[d.id];
    if (d.timeMissing && !time) return; // the button is disabled too
    const start = d.timeMissing ? `${d.start.slice(0, 10)}T${time}` : d.start;
    void run(`p-${d.id}`, async () => {
      const res = await fetch("/api/portal/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId,
          title: d.title,
          start,
          end: d.end ?? undefined,
          rrule: d.rrule ?? undefined,
          venue: d.venue || undefined,
          description: d.description,
          category: d.category,
          url: webLink(d.ticketUrl) ?? page?.url,
          organizer,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; pending?: boolean };
      if (!res.ok) throw new Error(out.error ?? "Couldn't publish that event — try again");
      // Only now is the draft retired.
      await call("POST", { action: "published", draftId: d.id });
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
      router.refresh();
      return out.pending ? PENDING_TEXT : "Event saved — it's on the town calendar now.";
    });
  }

  return (
    <FormSection
      title="Your events page"
      description="Paste the link to the page on your website that lists your events. We'll check it every morning and suggest events for you to publish."
    >
      <form onSubmit={save} className="flex flex-col gap-3">
        <TextField
          label="Link to your events page"
          type="url"
          inputMode="url"
          maxLength={500}
          placeholder="https://example.com/events"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          hint="The text of that page is sent to Anthropic's Claude to read the events. Nothing publishes until you press Publish."
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" pending={busy === "save"} disabled={busy !== null}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={check}
            pending={busy === "check"}
            pendingLabel="Checking…"
            disabled={busy !== null || !page}
          >
            Check now
          </Button>
        </div>
      </form>

      {page && (
        <p className="text-sm text-ink-soft">
          {page.lastCheckedAt
            ? `Last checked ${new Date(page.lastCheckedAt).toLocaleString("en-US", {
                timeZone: "America/Los_Angeles",
                dateStyle: "medium",
                timeStyle: "short",
              })}.`
            : "Not checked yet."}
          {page.lastError ? ` ${page.lastError}.` : ""}
        </p>
      )}

      <p
        role="status"
        aria-live="polite"
        className={`text-sm font-semibold ${message && !message.ok ? "text-danger" : "text-success-deep"}`}
      >
        {message?.text ?? ""}
      </p>

      {drafts.length > 0 && (
        <div>
          <h3 className="font-semibold text-primary-deep">Suggested events</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-primary-deep">{d.title}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {whenText(d)}
                    {d.venue ? ` · ${d.venue}` : ""}
                  </p>
                  {webLink(d.ticketUrl) && (
                    <p className="mt-0.5 text-sm">
                      <a
                        href={webLink(d.ticketUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-primary-deep underline"
                      >
                        Tickets
                      </a>
                    </p>
                  )}
                  {d.timeMissing && (
                    <div className="mt-2">
                      <p className="text-sm text-ink-soft">No time on your page — add one before publishing</p>
                      <label className="mt-1 flex items-center gap-2 text-sm font-semibold text-primary-deep">
                        Start time for {d.title}
                        <input
                          type="time"
                          value={times[d.id] ?? ""}
                          onChange={(e) => setTimes((prev) => ({ ...prev, [d.id]: e.target.value }))}
                          className="rounded-lg border border-border px-2 py-1 font-normal"
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    onClick={() => publish(d)}
                    pending={busy === `p-${d.id}`}
                    pendingLabel="Publishing…"
                    disabled={busy !== null || (d.timeMissing && !times[d.id])}
                    aria-label={`Publish ${d.title}`}
                  >
                    Publish
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => dismiss(d)}
                    disabled={busy !== null}
                    aria-label={`Dismiss ${d.title}`}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormSection>
  );
}
