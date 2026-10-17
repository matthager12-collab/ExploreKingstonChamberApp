import { z } from "zod";
import { timingSafeEqualStr } from "@/lib/auth/tokens";
import { claimResearch, finishResearch, claimPostExtraction, finishPostExtraction } from "@/lib/db/research";
import { researchContext } from "@/lib/research/context";
import { boundedJson, researchError } from "@/lib/research/http";
// This machine-only route has no publication operation and accepts no cookies.
export const dynamic = "force-dynamic";
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
  // Distinct operations fail closed on older deployments: they must never
  // degrade to a generic claim that could select an admin research job.
  z.object({ action: z.literal("claim-extraction"), id: z.string().uuid() }).strict(),
  z.object({
    action: z.enum(["complete-extraction", "fail-extraction"]),
    id: z.string().uuid(),
    leaseToken: z.string().uuid(),
    result: z.unknown().optional(),
  }).strict(),
  z.object({
    action: z.enum(["complete", "fail"]),
    id: z.string().uuid(),
    leaseToken: z.string().uuid(),
    result: z.unknown().optional(),
  }),
]);
export async function POST(request: Request) {
  const expected = process.env.CHAMBER_RESEARCH_TOKEN;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (
    !expected ||
    expected.length < 32 ||
    !timingSafeEqualStr(expected, provided)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const command = commandSchema.parse(await boundedJson(request));
    if (command.action === "claim-extraction") {
      const job = await claimPostExtraction(command.id);
      return Response.json({
        job: job ? {
          id: job.id,
          leaseToken: job.leaseToken,
          payload: { prompt: job.payload.prompt, extraction: {} },
        } : null,
        context: { now: new Date().toISOString(), timezone: "America/Los_Angeles" },
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "complete-extraction" || command.action === "fail-extraction") {
      const saved = await finishPostExtraction(
        command.id, command.leaseToken, command.result, command.action === "fail-extraction",
      );
      return Response.json({ request: { id: saved.id, state: saved.state, revision: saved.revision } },
        { headers: { "Cache-Control": "no-store" } });
    }
    const context = await researchContext();
    if (command.action === "claim") {
      const job = await claimResearch(context);
      return Response.json(
        { job, context: job?.payload.extraction
          ? { now: context.now, timezone: context.timezone }
          : context },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({
      request: await finishResearch(
        command.id,
        command.leaseToken,
        command.result,
        context,
        command.action === "fail",
      ),
    });
  } catch (error) {
    return researchError(error);
  }
}
