"use client";
import { EVENT_CATEGORIES } from "@/lib/schemas/event";
import { DraftMapPreview } from "./map-preview";
import { useCallback, useEffect, useState } from "react";
import { TextField, TextAreaField } from "@/components/portal/form";
import { PortalPanel } from "@/components/portal/page";
import {
  stateLabels,
  type Draft,
  type Proposal,
  type ResearchPayload,
} from "@/lib/research/schema";

type Job = {
  id: string;
  state: string;
  revision: number;
  payload: ResearchPayload;
  createdAt: string;
  updatedAt: string;
};
type Choices = {
  views: { id: string; name: string }[];
  categories: { key: string; label: string }[];
};
const button =
  "rounded-lg bg-primary-deep px-4 py-2.5 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed";
const secondary =
  "rounded-lg border border-border-strong bg-white px-4 py-2.5 font-semibold text-ink disabled:opacity-50";
const control =
  "w-full rounded-lg border border-border-strong bg-white px-3 py-2.5 text-base text-ink";
export function Assistant(choices: Choices) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [prompt, setPrompt] = useState(""),
    [links, setLinks] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [configured, setConfigured] = useState(true),
    [loaded, setLoaded] = useState(false);
  const [requestId, setRequestId] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/portal/assistant", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setJobs(data.requests);
    setConfigured(data.workerConfigured);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const initial = setTimeout(
      () => load().catch((e) => setError(e.message)),
      0,
    );
    const timer = setInterval(() => load().catch(() => {}), 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  async function mutate(method: string, data: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/portal/assistant", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      await load().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    if (
      await mutate("POST", {
        id,
        prompt,
        links: links
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
    ) {
      setPrompt("");
      setLinks("");
      setRequestId("");
      setNotice("Request saved. You can leave this page while research runs.");
    }
  }
  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger p-4 text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-ink">
          {notice}
        </p>
      )}
      {loaded && !configured && (
        <PortalPanel>
          <p>
            Research processing is awaiting setup. You can save requests now;
            they will stay queued until the research service connects.
          </p>
        </PortalPanel>
      )}
      <PortalPanel title="What would you like to add or change?">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextAreaField
            label="Your request"
            rows={4}
            required
            minLength={3}
            maxLength={8000}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setRequestId("");
            }}
            placeholder="Add kayak launches near Kingston, or find details about the fall festival at Heronswood."
          />
          <TextAreaField
            label="Links (optional, one per line)"
            rows={2}
            value={links}
            onChange={(e) => {
              setLinks(e.target.value);
              setRequestId("");
            }}
            hint="Google Maps, a Google search, a public Drive document, a website, or a social post. For private or inaccessible sources, paste the relevant details into your request."
          />
          <p className="text-sm text-ink-soft">
            Requests and source links are sent to the connected AI research
            service. Use public community information; keep private member
            information out of requests.
          </p>
          <div>
            <button className={button} disabled={busy}>
              Research & draft
            </button>
          </div>
        </form>
      </PortalPanel>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-primary-deep">
          Your requests
        </h2>
        <button
          className={secondary}
          disabled={busy}
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Refresh
        </button>
      </div>
      {!loaded ? (
        <p role="status">Loading requests…</p>
      ) : !jobs.length ? (
        <p>No requests yet. Start with a link or an idea above.</p>
      ) : (
        jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            choices={choices}
            busy={busy}
            mutate={mutate}
          />
        ))
      )}
    </>
  );
}
function JobCard({
  job,
  choices,
  busy,
  mutate,
}: {
  job: Job;
  choices: Choices;
  busy: boolean;
  mutate: (method: string, data: unknown) => Promise<boolean>;
}) {
  const [feedback, setFeedback] = useState("");
  const action = (data: object) =>
    mutate("PATCH", { id: job.id, revision: job.revision, ...data });
  return (
    <PortalPanel>
      <div className="flex flex-wrap justify-between gap-3">
        <h3 className="font-semibold text-primary-deep whitespace-pre-wrap">
          {job.payload.prompt}
        </h3>
        <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold text-ink">
          {stateLabels[job.state]}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        Submitted {new Date(job.createdAt).toLocaleString()}
      </p>
      {job.payload.links.length > 0 && (
        <ul className="mt-3 list-disc pl-5">
          {job.payload.links.map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-secondary underline"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {job.payload.summary && (
        <p className="mt-4 whitespace-pre-wrap">{job.payload.summary}</p>
      )}
      {job.payload.error && (
        <p className="mt-3 text-danger">{job.payload.error}</p>
      )}
      {job.state === "queued" && (
        <p className="mt-3 text-ink-soft">
          Saved and waiting for the research service. No need to keep this page
          open.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-4">
        {job.payload.drafts.map((draft) => (
          <DraftCard
            key={`${draft.id}-${job.revision}`}
            draft={draft}
            choices={choices}
            busy={busy}
            canReview={job.state === "review"}
            action={action}
          />
        ))}
      </div>
      {["review", "failed", "cancelled", "complete"].includes(job.state) && (
        <div className="mt-5 flex flex-col gap-3">
          <TextAreaField
            label="Add details or request revisions"
            rows={2}
            maxLength={4000}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Use the north entrance. Skip the second location. Make the post shorter."
          />
          <div>
            <button
              className={secondary}
              disabled={busy}
              onClick={async () => {
                if (await action({ action: "retry", feedback }))
                  setFeedback("");
              }}
            >
              Research again
            </button>
          </div>
        </div>
      )}
      {["queued", "researching"].includes(job.state) && (
        <button
          className={`${secondary} mt-4`}
          disabled={busy}
          onClick={() => action({ action: "cancel" })}
        >
          Cancel research
        </button>
      )}
    </PortalPanel>
  );
}
function DraftCard({
  draft,
  choices,
  busy,
  canReview,
  action,
}: {
  draft: Draft;
  choices: Choices;
  busy: boolean;
  canReview: boolean;
  action: (data: object) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(draft.title),
    [body, setBody] = useState(draft.body),
    [questions, setQuestions] = useState(draft.questions.join("\n")),
    [data, setData] = useState(draft.data),
    [copied, setCopied] = useState(false);
  const set = (key: string, value: unknown) =>
    setData((d) => ({ ...d, [key]: value }));
  async function save() {
    const proposal: Proposal = {
      ...draft,
      title,
      body,
      data,
      questions: questions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (await action({ action: "edit", draftId: draft.id, proposal }))
      setEditing(false);
  }
  const open = draft.state === "draft" && canReview;
  const point = Array.isArray(data.point) ? data.point : ["", ""];
  return (
    <article className="rounded-xl border border-border p-4">
      <p className="text-sm font-semibold text-ink-soft">
        {draft.kind === "map"
          ? "Map entry"
          : draft.kind === "event"
            ? "Calendar event"
            : "Post draft"}{" "}
        · {draft.targetId ? "Update existing" : "New"} ·{" "}
        {draft.state === "approved" ? "Approved for copying" : draft.state}
      </p>
      {editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextAreaField
            label="Description / post text"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {draft.kind === "map" && (
            <>
              <label className="font-semibold">
                Map
                <select
                  className={control}
                  value={
                    Array.isArray(data.views) ? String(data.views[0] ?? "") : ""
                  }
                  onChange={(e) => set("views", [e.target.value])}
                >
                  <option value="">Choose a map</option>
                  {choices.views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-semibold">
                Icon
                <select
                  className={control}
                  value={String(data.category ?? "")}
                  onChange={(e) => set("category", e.target.value)}
                >
                  <option value="">Default</option>
                  {choices.categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {data.kind === "marker" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    type="number"
                    step="any"
                    label="Latitude"
                    value={String(point[0])}
                    onChange={(e) =>
                      set("point", [
                        e.target.value === "" ? null : Number(e.target.value),
                        point[1],
                      ])
                    }
                  />
                  <TextField
                    type="number"
                    step="any"
                    label="Longitude"
                    value={String(point[1])}
                    onChange={(e) =>
                      set("point", [
                        point[0],
                        e.target.value === "" ? null : Number(e.target.value),
                      ])
                    }
                  />
                </div>
              )}
            </>
          )}
          {draft.kind === "event" && (
            <label className="font-semibold">
              Event category
              <select
                className={control}
                value={String(data.category ?? "")}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="">Choose category</option>
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.kind === "event" &&
            ["start", "end", "venue", "address", "organizer", "url"].map(
              (key) => (
                <TextField
                  key={key}
                  label={
                    key === "start"
                      ? "Starts (ISO date/time, Pacific)"
                      : key === "end"
                        ? "Ends (ISO date/time, Pacific)"
                        : key[0].toUpperCase() + key.slice(1)
                  }
                  value={String(data[key] ?? "")}
                  onChange={(e) => set(key, e.target.value)}
                />
              ),
            )}
          <TextAreaField
            label="Unresolved questions"
            hint="Update the details above, then remove the questions you have resolved. Publishing is blocked while questions remain."
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy} onClick={save}>
              Save draft
            </button>
            <button
              className={secondary}
              onClick={() => {
                setTitle(draft.title);
                setBody(draft.body);
                setQuestions(draft.questions.join("\n"));
                setData(draft.data);
                setEditing(false);
              }}
            >
              Close editor
            </button>
          </div>
        </div>
      ) : (
        <>
          <h4 className="mt-2 text-lg font-semibold">{draft.title}</h4>
          <p className="mt-2 whitespace-pre-wrap">{draft.body}</p>
          {draft.kind === "event" && (
            <dl className="mt-3 grid gap-1">
              {["start", "end", "venue", "address", "organizer", "category"]
                .filter((k) => data[k])
                .map((k) => (
                  <div key={k}>
                    <dt className="inline font-semibold">{k}: </dt>
                    <dd className="inline">{String(data[k])}</dd>
                  </div>
                ))}
            </dl>
          )}
          {draft.kind === "map" && (
            <div className="mt-3">
              <DraftMapPreview
                title={draft.title}
                body={draft.body}
                data={draft.data}
              />
              <p>
                Map:{" "}
                {Array.isArray(data.views)
                  ? data.views
                      .map(
                        (v) => choices.views.find((x) => x.id === v)?.name ?? v,
                      )
                      .join(", ")
                  : "Needs selection"}{" "}
                · Icon: {String(data.category ?? "default")}
              </p>
              {Array.isArray(data.point) && (
                <a
                  className="text-secondary underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.point.join(","))}`}
                >
                  Check pin on Google Maps ({data.point.join(", ")})
                </a>
              )}
            </div>
          )}
          {draft.before && (
            <details className="mt-3">
              <summary className="cursor-pointer font-semibold">
                Current published version
              </summary>
              <p className="mt-2 whitespace-pre-wrap">
                {String(draft.before.title ?? "")} —{" "}
                {String(draft.before.notes ?? draft.before.description ?? "")}
              </p>
            </details>
          )}
        </>
      )}
      <ul className="mt-3 list-disc pl-5 text-sm">
        {draft.sources.map((s, i) => (
          <li key={i}>
            <a
              className="text-secondary underline"
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.title || s.url}
            </a>
          </li>
        ))}
      </ul>
      {draft.questions.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface-sunken p-3">
          <p className="font-semibold">Needs your confirmation</p>
          <ul className="list-disc pl-5">
            {draft.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {!editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          {open && (
            <>
              <button
                className={button}
                disabled={busy || draft.questions.length > 0}
                onClick={() => action({ action: "publish", draftId: draft.id })}
              >
                {draft.kind === "post" ? "Approve copy" : "Approve & publish"}
              </button>
              <button
                className={secondary}
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Edit draft
              </button>
              <button
                className={secondary}
                disabled={busy}
                onClick={() => action({ action: "dismiss", draftId: draft.id })}
              >
                Skip
              </button>
            </>
          )}
          {draft.kind === "post" && (
            <button
              className={secondary}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${draft.title}\n\n${draft.body}`,
                  );
                  setCopied(true);
                } catch {
                  setEditing(true);
                }
              }}
            >
              {copied ? "Copied" : "Copy text"}
            </button>
          )}
        </div>
      )}
      {draft.kind === "post" && (
        <p className="mt-2 text-sm text-ink-soft">
          Copy for your website or social account. Approval here does not post
          to an external service.
        </p>
      )}
    </article>
  );
}
