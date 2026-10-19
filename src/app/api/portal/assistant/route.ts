import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  createResearch,
  listResearch,
  reviewResearch,
} from "@/lib/db/research";
import { researchContext } from "@/lib/research/context";
import { boundedJson, researchError, sameOrigin } from "@/lib/research/http";
import { revalidatePublicPathsForStore } from "@/lib/public-paths";
export const dynamic = "force-dynamic";
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      requests: await listResearch(),
      workerConfigured: !!process.env.CHAMBER_RESEARCH_TOKEN,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!sameOrigin(request))
    return Response.json(
      { error: "Use the portal to submit changes." },
      { status: 403 },
    );
  try {
    return Response.json(
      {
        request: await createResearch(
          await boundedJson(request),
          (await getSessionUser())!.email,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return researchError(error);
  }
}
export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!sameOrigin(request))
    return Response.json(
      { error: "Use the portal to review changes." },
      { status: 403 },
    );
  try {
    const body = await boundedJson(request);
    const saved = await reviewResearch(
      body,
      (await getSessionUser())!.email,
      await researchContext(),
    );
    if (body.action === "publish") {
      await revalidatePublicPathsForStore("events");
      // Map reads are dynamic; also invalidate public page shells that embed maps.
      const { revalidatePath } = await import("next/cache");
      for (const path of ["/map", "/parking", "/ferry", "/itineraries"])
        revalidatePath(path);
    }
    return Response.json({ request: saved });
  } catch (error) {
    return researchError(error);
  }
}
