// Public read API for a resolved map view — powers the <FeatureMap> component.

import { NextRequest, NextResponse } from "next/server";
import { resolveMapView } from "@/lib/map/resolve";
import { getMapView } from "@/lib/stores/map-store";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await ctx.params;

  const view = await getMapView(viewId);
  if (!view) {
    return NextResponse.json({ error: "unknown view" }, { status: 404 });
  }
  // Unpublished (draft) views are only served to admins. This branch alone is
  // gated — a published view stays fully public, no session required.
  //
  // The gate's VERDICT is consumed here but its response is deliberately not
  // returned: a draft view's very existence is non-public, so answering 401/403
  // would confirm the id to anyone probing. 404 is the same answer an unknown
  // id gets, which is the point. (Imported lazily so the public path above
  // never pulls the auth/DB module graph in at module scope.)
  if (!view.published) {
    const { requireAdmin } = await import("@/lib/auth");
    if (await requireAdmin()) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  const resolved = await resolveMapView(viewId);
  if (!resolved) {
    return NextResponse.json({ error: "unknown view" }, { status: 404 });
  }
  return NextResponse.json(resolved, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" },
  });
}
