import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "./client";
import { researchRequest, record, audit, type ResearchRow } from "./schema";
import { writeRecord } from "./records";
import {
  intakeSchema,
  mapDraftSchema,
  researchResultSchema,
  reviewSchema,
  type Draft,
  type ResearchPayload,
} from "@/lib/research/schema";
import {
  documentOnly,
  sameDocument,
  type ResearchContext,
} from "@/lib/research/context";
import { eventSchema } from "@/lib/schemas/event";
import { pacificDateKey } from "@/lib/events/tz";
import { normalizeEventTimestamp } from "@/lib/time";

export class ResearchConflict extends Error {}
export function publicRequest(row: ResearchRow) {
  const { leaseToken: _token, leaseUntil: _until, ...safe } = row;
  const { baseline: _baseline, ...payload } = safe.payload;
  return { ...safe, payload };
}
export async function listResearch() {
  return (
    await getDb()
      .select()
      .from(researchRequest)
      .orderBy(desc(researchRequest.createdAt))
      .limit(100)
  ).map(publicRequest);
}
export async function createResearch(input: unknown, actor: string) {
  const parsed = intakeSchema.parse(input);
  const [row] = await getDb()
    .insert(researchRequest)
    .values({
      id: parsed.id,
      createdBy: actor,
      payload: {
        prompt: parsed.prompt,
        links: parsed.links,
        summary: "",
        drafts: [],
        feedback: [],
      },
    })
    .onConflictDoNothing()
    .returning();
  if (row) return publicRequest(row);
  const [existing] = await getDb()
    .select()
    .from(researchRequest)
    .where(eq(researchRequest.id, parsed.id));
  if (
    !existing ||
    existing.createdBy !== actor ||
    existing.payload.prompt !== parsed.prompt ||
    !sameDocument(existing.payload.links, parsed.links)
  )
    throw new ResearchConflict(
      "This request ID is already in use. Refresh and try again.",
    );
  return publicRequest(existing);
}
export async function claimResearch(context: ResearchContext) {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select()
      .from(researchRequest)
      .where(
        or(
          eq(researchRequest.state, "queued"),
          and(
            eq(researchRequest.state, "researching"),
            lt(researchRequest.leaseUntil, now),
          ),
        ),
      )
      .orderBy(asc(researchRequest.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    if (row.attempts >= 3) {
      await tx
        .update(researchRequest)
        .set({
          state: "failed",
          leaseToken: null,
          leaseUntil: null,
          revision: row.revision + 1,
          payload: {
            ...row.payload,
            error:
              "Research stopped after three interrupted attempts. Please retry.",
          },
        })
        .where(eq(researchRequest.id, row.id));
      return null;
    }
    const [claimed] = await tx
      .update(researchRequest)
      .set({
        state: "researching",
        payload: {
          ...row.payload,
          baseline: Object.fromEntries([
            ...context.maps.map((r) => [`map:${r.id}`, documentOnly(r)]),
            ...context.events.map((r) => [`event:${r.id}`, documentOnly(r)]),
          ]),
        },
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() + 20 * 60_000),
        attempts: row.attempts + 1,
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(eq(researchRequest.id, row.id))
      .returning();
    return claimed;
  });
}
export async function finishResearch(
  id: string,
  lease: string,
  result: unknown,
  context: ResearchContext,
  failure = false,
) {
  void context; // Completion uses the snapshot captured when the worker claimed the job.
  const parsed = failure ? null : researchResultSchema.parse(result);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(researchRequest)
      .where(eq(researchRequest.id, id))
      .for("update");
    if (
      !row ||
      row.state !== "researching" ||
      row.leaseToken !== lease ||
      !row.leaseUntil ||
      row.leaseUntil.getTime() < Date.now()
    )
      throw new ResearchConflict(
        "This research attempt has expired. Its results were not applied.",
      );
    const drafts: Draft[] = (parsed?.drafts ?? []).map((p) => {
      const existing = p.targetId
        ? row.payload.baseline?.[`${p.kind}:${p.targetId}`]
        : null;
      if (p.targetId && (p.kind === "post" || !existing))
        throw new ResearchConflict(
          "A proposed update references a missing record. Research it again.",
        );
      return {
        ...p,
        id: randomUUID(),
        state: "draft",
        before: existing ? documentOnly(existing) : null,
      };
    });
    const payload: ResearchPayload = {
      ...row.payload,
      summary: parsed?.summary ?? row.payload.summary,
      drafts: [
        ...row.payload.drafts.filter(
          (d) => d.state === "published" || d.state === "approved",
        ),
        ...drafts,
      ],
      error: failure
        ? "Research could not finish. Your request is saved; retry or add more detail."
        : undefined,
    };
    const [saved] = await tx
      .update(researchRequest)
      .set({
        state: failure ? "failed" : "review",
        payload,
        leaseToken: null,
        leaseUntil: null,
        revision: row.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(researchRequest.id, id))
      .returning();
    return publicRequest(saved);
  });
}

export async function reviewResearch(
  input: unknown,
  actor: string,
  context: ResearchContext,
) {
  const command = reviewSchema.parse(input);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(researchRequest)
      .where(eq(researchRequest.id, command.id))
      .for("update");
    if (!row || row.revision !== command.revision)
      throw new ResearchConflict(
        "This request changed. Refresh before reviewing it.",
      );
    const payload = structuredClone(row.payload);
    let state = row.state;
    if (command.action === "retry") {
      if (!["review", "failed", "cancelled", "complete"].includes(state))
        throw new ResearchConflict("Research is already queued or running.");
      payload.feedback = [...payload.feedback, command.feedback]
        .filter(Boolean)
        .slice(-10);
      payload.error = undefined;
      state = "queued";
    } else if (command.action === "cancel") {
      state = "cancelled";
    } else {
      if (state !== "review")
        throw new ResearchConflict("This request is not ready for review.");
      const draft = payload.drafts.find((d) => d.id === command.draftId);
      if (!draft || draft.state !== "draft")
        throw new ResearchConflict("This draft has already been handled.");
      if (command.action === "edit") {
        if (
          command.proposal.kind !== draft.kind ||
          command.proposal.targetId !== draft.targetId
        )
          throw new ResearchConflict(
            "Changing the destination requires a new research request.",
          );
        Object.assign(draft, command.proposal);
      } else if (command.action === "dismiss") draft.state = "dismissed";
      else {
        if (draft.questions.length)
          throw new ResearchConflict(
            "Resolve the open questions before approving this draft.",
          );
        if (draft.kind === "post") draft.state = "approved";
        else {
          // Short publish transaction. Serializes with all ordinary record writers,
          // including creates where no row exists yet; prevents stale overwrite.
          await tx.execute(sql`LOCK TABLE record IN SHARE ROW EXCLUSIVE MODE`);
          const store = draft.kind === "map" ? "map-features" : "events";
          const id = draft.targetId || `research-${draft.id}`;
          const [overlay] = await tx
            .select()
            .from(record)
            .where(and(eq(record.store, store), eq(record.id, id)));
          const source = (
            draft.kind === "map" ? context.maps : context.events
          ).find((r) => r.id === id);
          const current = overlay
            ? overlay.deleted
              ? null
              : overlay.doc
            : source
              ? documentOnly(source)
              : null;
          if (draft.targetId && !sameDocument(current, draft.before))
            throw new ResearchConflict(
              "The live record changed since research. Request a fresh draft before replacing it.",
            );
          if (!draft.targetId && current)
            throw new ResearchConflict("This item already exists.");
          let doc: Record<string, unknown> & { id: string };
          if (draft.kind === "map") {
            const parsed = mapDraftSchema.parse({
              ...draft.data,
              title: draft.title,
              notes: draft.body,
            });
            if (
              parsed.views.some((v) => !context.views.some((x) => x.id === v))
            )
              throw new ResearchConflict("Select an existing map view.");
            if (
              parsed.category &&
              !context.categories.some((c) => c.key === parsed.category)
            )
              throw new ResearchConflict("Select a supported map icon.");
            const {
              point: _point,
              path: _path,
              polygon: _polygon,
              ...preserved
            } = current ?? {};
            doc = { ...preserved, ...parsed, id };
          } else {
            const allowed = Object.fromEntries(
              Object.entries(draft.data).filter(([key]) =>
                [
                  "start",
                  "end",
                  "venue",
                  "address",
                  "organizer",
                  "category",
                  "url",
                ].includes(key),
              ),
            );
            const parsed = eventSchema.parse({
              ...current,
              ...allowed,
              id,
              title: draft.title,
              description: draft.body,
            });
            parsed.start = normalizeEventTimestamp(parsed.start);
            if (parsed.end) parsed.end = normalizeEventTimestamp(parsed.end);
            if (
              !Number.isFinite(Date.parse(parsed.start)) ||
              (parsed.end &&
                (!Number.isFinite(Date.parse(parsed.end)) ||
                  Date.parse(parsed.end) <= Date.parse(parsed.start)))
            )
              throw new ResearchConflict(
                "Check the event start and end times.",
              );
            doc = parsed;
          }
          // Compare against both seeds and current overlays while holding the lock.
          const overlays = await tx
            .select()
            .from(record)
            .where(eq(record.store, store));
          const existing = new Map(
            (draft.kind === "map" ? context.maps : context.events).map((r) => [
              r.id,
              documentOnly(r),
            ]),
          );
          for (const r of overlays) {
            if (r.deleted) existing.delete(r.id);
            else existing.set(r.id, r.doc);
          }
          const normalized = (v: unknown) =>
            String(v ?? "")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
          if (
            draft.kind === "event" &&
            context.calendar.some(
              (e) =>
                e.source !== "in-app" &&
                normalized(e.title) === normalized(doc.title) &&
                pacificDateKey(e.startIso) ===
                  pacificDateKey(String(doc.start)),
            )
          ) {
            throw new ResearchConflict(
              "This event is already in a connected calendar. Review it in Event sources before adding another listing.",
            );
          }
          for (const [otherId, other] of existing) {
            if (otherId === id) continue;
            if (
              normalized(other.title) === normalized(doc.title) &&
              (draft.kind === "map" ||
                pacificDateKey(normalizeEventTimestamp(String(other.start))) ===
                  pacificDateKey(String(doc.start)))
            )
              throw new ResearchConflict(
                "A matching listing already exists. Ask to update that entry instead.",
              );
          }
          await writeRecord(
            store,
            doc,
            { actor, source: "admin", status: "live" },
            tx,
          );
          draft.state = "published";
          draft.publishedAt = new Date().toISOString();
        }
      }
      if (
        payload.drafts.length &&
        payload.drafts.every((d) => d.state !== "draft")
      )
        state = "complete";
    }
    const [saved] = await tx
      .update(researchRequest)
      .set({
        payload,
        state,
        revision: row.revision + 1,
        updatedAt: new Date(),
        ...(command.action === "retry" ? { attempts: 0 } : {}),
        ...(command.action === "cancel"
          ? { leaseToken: null, leaseUntil: null }
          : {}),
      })
      .where(eq(researchRequest.id, row.id))
      .returning();
    // Only action metadata enters the permanent audit trail, not private prompts.
    await tx.insert(audit).values({
      actor,
      action: `research-${command.action}`,
      store: "research",
      recordId: row.id,
      source: "admin",
      after: {
        revision: saved.revision,
        draftId: "draftId" in command ? command.draftId : null,
      },
    });
    return publicRequest(saved);
  });
}
