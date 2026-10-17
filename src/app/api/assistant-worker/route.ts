import { z } from "zod";
import { timingSafeEqualStr } from "@/lib/auth/tokens";
import { claimResearch, finishResearch } from "@/lib/db/research";
import { researchContext } from "@/lib/research/context";
import { boundedJson, researchError } from "@/lib/research/http";
// This machine-only route has no publication operation and accepts no cookies.
export const dynamic = "force-dynamic";
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
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
    const context = await researchContext();
    if (command.action === "claim")
      return Response.json(
        { job: await claimResearch(context), context },
        { headers: { "Cache-Control": "no-store" } },
      );
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
