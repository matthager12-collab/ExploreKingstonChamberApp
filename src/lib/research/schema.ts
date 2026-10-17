import { z } from "zod";

// These URLs are links for review / the web-research provider. The app never
// fetches arbitrary user URLs with its own network credentials.
export const sourceUrl = z
  .string()
  .url()
  .max(2000)
  .refine((v) => {
    const u = new URL(v);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use a public http or https link without credentials");
export const intakeSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().min(3).max(8000),
  links: z.array(sourceUrl).max(10).default([]),
});
export const proposalSchema = z.object({
  kind: z.enum(["map", "event", "post"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10000),
  sources: z
    .array(z.object({ url: sourceUrl, title: z.string().max(300) }))
    .min(1)
    .max(15),
  questions: z.array(z.string().max(1000)).max(15),
  // Blank = create. An update must name an existing record from job context.
  targetId: z.string().max(64).default(""),
  data: z.record(z.string(), z.unknown()),
});
export const researchResultSchema = z.object({
  summary: z.string().max(5000),
  drafts: z.array(proposalSchema).max(20),
});
export type Proposal = z.infer<typeof proposalSchema>;
export type ResearchResult = z.infer<typeof researchResultSchema>;
export type Draft = Proposal & {
  id: string;
  state: "draft" | "published" | "dismissed" | "approved";
  before: Record<string, unknown> | null;
  publishedAt?: string;
};
export type ResearchPayload = {
  prompt: string;
  links: string[];
  summary: string;
  drafts: Draft[];
  feedback: string[];
  error?: string;
  baseline?: Record<string, Record<string, unknown>>;
};
export const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("retry"),
    id: z.string().uuid(),
    revision: z.number().int(),
    feedback: z.string().trim().max(4000).default(""),
  }),
  z.object({
    action: z.literal("cancel"),
    id: z.string().uuid(),
    revision: z.number().int(),
  }),
  z.object({
    action: z.enum(["publish", "dismiss"]),
    id: z.string().uuid(),
    revision: z.number().int(),
    draftId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("edit"),
    id: z.string().uuid(),
    revision: z.number().int(),
    draftId: z.string().uuid(),
    proposal: proposalSchema,
  }),
]);
export const pointSchema = z.tuple([
  z.number().min(47.5).max(48.1),
  z.number().min(-123).max(-122.2),
]);
export const mapDraftSchema = z
  .object({
    kind: z.enum(["marker", "line", "trail", "area"]),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).optional(),
    category: z.string().max(80).optional(),
    link: sourceUrl.optional(),
    views: z.array(z.string().min(1)).min(1).max(20),
    point: pointSchema.optional(),
    path: z.array(pointSchema).min(2).max(2000).optional(),
    polygon: z.array(pointSchema).min(3).max(2000).optional(),
  })
  .refine(
    (d) =>
      d.kind === "marker"
        ? !!d.point
        : d.kind === "area"
          ? !!d.polygon
          : !!d.path,
    "Verified map geometry is required",
  );
export const stateLabels: Record<string, string> = {
  queued: "Waiting for research",
  researching: "Researching",
  review: "Ready for review",
  failed: "Needs attention",
  complete: "Completed",
  cancelled: "Cancelled",
};
