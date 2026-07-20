// POST /api/admin/geoip/refresh — force a GeoLite2 database refresh (E10 §6).
//
// Admin-only (the bundle download tier). Two callers:
//  - the no-JS <form method="post"> button on /admin/ops → we 303-redirect back
//    to /admin/ops so the browser lands on a GET and the geo-IP tile reflects the
//    new state;
//  - a scripted client that Accepts JSON → we answer { ok, mtimeIso, edition }.
//
// Human-only: it is deliberately NOT in the proxy's MACHINE_TOKEN_ROUTES, so no
// machine token can trigger a download. Self-gates with requireAdmin() as its
// first act (route handlers bypass layouts; the admin-walk test proves it fires).

import { requireAdmin } from "@/lib/auth";
import { refreshGeoip } from "@/lib/geoip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  try {
    const status = await refreshGeoip();
    if (wantsJson) {
      return Response.json({
        ok: true,
        edition: status.edition,
        mtimeIso: status.mtimeIso ?? null,
      });
    }
    return Response.redirect(new URL("/admin/ops", request.url), 303);
  } catch (err) {
    const message = err instanceof Error ? err.message : "refresh failed";
    if (wantsJson) {
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
    // No-JS form: send the operator back to the ops page regardless; the geo-IP
    // tile shows the still-absent/stale state on reload.
    return Response.redirect(new URL("/admin/ops", request.url), 303);
  }
}
