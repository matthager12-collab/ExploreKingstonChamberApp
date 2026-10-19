import "server-only";
import { getUnifiedEvents } from "@/lib/events/unified";
import { getMapFeaturesAdmin, getMapViews } from "@/lib/stores/map-store";
import { getEventsAdmin } from "@/lib/stores/event-store";
import { MARKER_CATEGORIES } from "@/lib/map/types";
export async function researchContext() {
  const [maps, views, events, calendar] = await Promise.all([
    getMapFeaturesAdmin(),
    getMapViews(),
    getEventsAdmin(),
    getUnifiedEvents(),
  ]);
  return {
    maps,
    views,
    events,
    calendar,
    categories: MARKER_CATEGORIES,
    now: new Date().toISOString(),
    timezone: "America/Los_Angeles",
  };
}
export type ResearchContext = Awaited<ReturnType<typeof researchContext>>;
export function documentOnly(value: object): Record<string, unknown> {
  const { status: _status, ...doc } = value as Record<string, unknown>;
  return JSON.parse(JSON.stringify(doc));
}
export function sameDocument(a: unknown, b: unknown): boolean {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
