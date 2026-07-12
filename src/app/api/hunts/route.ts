// Hunt CRUD + submissions listing for the admin builder.
//
// Admin-only. Public play pages (/hunt, /hunt/[slug]) read hunt content from
// the store directly server-side, and players never call this route — the only
// unauthenticated hunt endpoint is /api/hunts/submit (photo upload). So both
// GET (which can list player submissions via ?submissions=) and POST require an
// admin session; the /admin layout gates the editor UI, this re-checks because
// route handlers bypass layouts.

import { NextRequest } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  getAllHunts,
  isSafeId,
  listSubmissions,
  photoUrl,
  saveHunt,
  type StoredHunt,
  type StoredHuntStop,
} from "@/lib/hunt-store";

/**
 * GET /api/hunts                     → { hunts: [...] } (seed + custom merged,
 *                                      stops carry referencePhotoUrl)
 * GET /api/hunts?submissions=<huntId> → { submissions: [...] } newest first
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const submissionsFor = request.nextUrl.searchParams.get("submissions");
  if (submissionsFor) {
    if (!isSafeId(submissionsFor)) {
      return Response.json({ error: "invalid hunt id" }, { status: 400 });
    }
    const submissions = await listSubmissions(submissionsFor);
    return Response.json({
      submissions: submissions.map((s) => ({ ...s, photoUrl: photoUrl(s.photoPath) })),
    });
  }

  const hunts = await getAllHunts();
  return Response.json({
    hunts: hunts.map((hunt) => ({
      ...hunt,
      stops: hunt.stops.map((stop) => ({
        ...stop,
        referencePhotoUrl: stop.referencePhoto ? photoUrl(stop.referencePhoto) : undefined,
      })),
    })),
  });
}

/** POST /api/hunts — create or update a hunt from a full Hunt JSON body. */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = await getSessionUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseHuntPayload(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const saved = await saveHunt(parsed.hunt, { actor: user?.email, source: "admin" });
    return Response.json({ ok: true, hunt: saved });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "could not save hunt" },
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function str(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function parseHuntPayload(body: unknown): { hunt: StoredHunt } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "hunt object required" };
  const h = body as Record<string, unknown>;

  const slug = str(h.slug, 64).toLowerCase();
  if (!SLUG_RE.test(slug)) return { error: "slug must be lowercase letters, numbers, and dashes" };
  const id = str(h.id, 64) || slug;
  if (!isSafeId(id)) return { error: "invalid hunt id" };

  const title = str(h.title, 120);
  if (!title) return { error: "title is required" };
  const description = str(h.description, 2000);
  const difficulty = h.difficulty === "moderate" ? "moderate" : "easy";
  const durationMinutes = Math.min(Math.max(Math.round(num(h.durationMinutes) ?? 45), 5), 600);

  if (!Array.isArray(h.stops) || h.stops.length === 0) {
    return { error: "at least one stop is required" };
  }
  if (h.stops.length > 40) return { error: "too many stops (max 40)" };

  const stops: StoredHuntStop[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < h.stops.length; i++) {
    const raw = h.stops[i];
    if (typeof raw !== "object" || raw === null) return { error: `stop ${i + 1} is invalid` };
    const s = raw as Record<string, unknown>;
    const stopId = str(s.id, 64);
    if (!isSafeId(stopId)) return { error: `stop ${i + 1} has an invalid id` };
    if (seenIds.has(stopId)) return { error: `duplicate stop id: ${stopId}` };
    seenIds.add(stopId);
    const stopTitle = str(s.title, 120);
    if (!stopTitle) return { error: `stop ${i + 1} needs a title` };
    const lat = num(s.lat);
    const lng = num(s.lng);
    if (lat === undefined || lat < -90 || lat > 90) return { error: `stop ${i + 1}: latitude must be -90..90` };
    if (lng === undefined || lng < -180 || lng > 180) return { error: `stop ${i + 1}: longitude must be -180..180` };
    const radiusMeters = Math.min(Math.max(Math.round(num(s.radiusMeters) ?? 100), 20), 1000);
    const referencePhoto = str(s.referencePhoto, 400);
    stops.push({
      id: stopId,
      title: stopTitle,
      clue: str(s.clue, 1000),
      hint: str(s.hint, 1000),
      lat,
      lng,
      radiusMeters,
      photoPrompt: str(s.photoPrompt, 500),
      funFact: str(s.funFact, 1000),
      ...(referencePhoto ? { referencePhoto } : {}), // saveHunt re-validates the path
    });
  }

  return { hunt: { id, slug, title, description, difficulty, durationMinutes, stops } };
}
