import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { can, type AuthSubject } from "@/lib/auth/authz";
import { getDb } from "@/lib/db/client";
import { researchRequest, type ResearchRow } from "@/lib/db/schema";
import { ResearchConflict } from "@/lib/db/research";
import { MAX_POST_CHARS } from "@/lib/events/extract-post";

// Queue configuration is not a worker heartbeat. Queued jobs explicitly say
// "Waiting for computer" until the outbound Mac worker claims them.
export function extractionConfigured() {
  return (process.env.CHAMBER_RESEARCH_TOKEN?.length ?? 0) >= 32;
}

const submitSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(MAX_POST_CHARS),
});
export class ExtractionUnavailable extends Error {}

function assertOwner(row: ResearchRow | undefined, user: AuthSubject) {
  const metadata = row?.payload.extraction;
  // Even staff cannot read another submitter's pasted text through this API.
  // Recheck the current listing permission on every read and cancellation.
  if (!row || !metadata || metadata.requesterId !== user.id ||
      !can(user, "edit-record", metadata.ownerId)) {
    throw new ExtractionUnavailable("This post request is unavailable.");
  }
  return metadata;
}

function status(row: ResearchRow) {
  return {
    id: row.id,
    state: row.state,
    revision: row.revision,
    ...(row.payload.error ? { error: row.payload.error } : {}),
    ...(row.payload.extraction?.draft ? { draft: row.payload.extraction.draft } : {}),
  };
}

export async function submitPostExtraction(input: unknown, user: AuthSubject) {
  const parsed = submitSchema.parse(input);
  if (!can(user, "edit-record", parsed.ownerId)) {
    throw new ExtractionUnavailable("This post request is unavailable.");
  }
  const textHash = createHash("sha256").update(parsed.text).digest("hex");
  const [row] = await getDb().insert(researchRequest).values({
    id: parsed.id,
    createdBy: user.email,
    payload: {
      prompt: parsed.text,
      links: [], summary: "", drafts: [], feedback: [],
      extraction: {
        requesterId: user.id,
        ownerId: parsed.ownerId,
        textHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      },
    },
  }).onConflictDoNothing().returning();
  if (row) return status(row);
  const [existing] = await getDb().select().from(researchRequest)
    .where(eq(researchRequest.id, parsed.id));
  const metadata = assertOwner(existing, user);
  if (metadata.ownerId !== parsed.ownerId || metadata.textHash !== textHash) {
    throw new ResearchConflict("This request ID is already in use. Try a new request.");
  }
  return readPostExtraction(parsed.id, user);
}

export async function readPostExtraction(id: string, user: AuthSubject, cancel = false) {
  z.string().uuid().parse(id);
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(researchRequest)
      .where(eq(researchRequest.id, id)).for("update");
    const metadata = assertOwner(row, user);
    const expired = Date.parse(metadata.expiresAt) <= Date.now();
    if (cancel || expired) {
      // Physically scrub at first access/worker sweep after expiration. This
      // is not a promise of timed deletion while both app and worker are idle.
      const [saved] = await tx.update(researchRequest).set({
        state: "cancelled",
        payload: { ...row.payload, prompt: "", error: undefined,
          extraction: { ...metadata, draft: undefined } },
        leaseToken: null, leaseUntil: null,
        revision: row.revision + 1, updatedAt: new Date(),
      }).where(eq(researchRequest.id, id)).returning();
      return status(saved);
    }
    return status(row);
  });
}
