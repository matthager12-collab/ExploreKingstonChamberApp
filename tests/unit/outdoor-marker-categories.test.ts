import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { MARKER_CATEGORIES, markerCategory, labelPriority } from "@/lib/map/types";
import { getMapFeatures } from "@/lib/stores/map-store";
import { resolveMapView } from "@/lib/map/resolve";
import { POST } from "@/app/api/admin/map-features/route";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => null),
  getSessionUser: vi.fn(async () => ({ email: "map-test@example.test" })),
}));

const categories = [
  ["kayak", "Kayak / paddlecraft", "🛶"],
  ["bicycle", "Bike / bicycle-friendly trail", "🚲"],
  ["playground", "Playground", "🛝"],
  ["boat", "Boat / marina", "⛵"],
  ["golf", "Golf", "⛳"],
] as const;

let tdb: TestDb;
beforeAll(async () => { tdb = await createTestDb(); });
afterAll(() => tdb.close());

describe("outdoor marker categories", () => {
  it.each(categories)("offers a named %s icon and outdoor label priority", (key, label, emoji) => {
    expect(MARKER_CATEGORIES.find((c) => c.key === key)).toMatchObject({ key, label, emoji });
    expect(markerCategory(key).key).toBe(key);
    expect(labelPriority(key)).toBeGreaterThanOrEqual(labelPriority("park"));
  });

  it.each(categories)("preserves %s through admin API, storage and public resolution", async (key) => {
    const feature = { id: `test-outdoor-${key}`, title: `Test ${key}`, kind: "marker", category: key, point: [47.798, -122.499], views: ["trails"] };
    const response = await POST(new NextRequest("http://localhost/api/admin/map-features", {
      method: "POST", body: JSON.stringify(feature),
    }));
    expect(response.status).toBe(200);
    const stored = (await getMapFeatures()).find((f) => f.id === feature.id);
    expect(stored).toMatchObject(feature);
    const publicView = await resolveMapView("trails");
    expect(publicView?.features.find((f) => f.id === feature.id)).toMatchObject(feature);
    // A second save is the edit/reopen path; it must not silently strip the key.
    const edited = await POST(new NextRequest("http://localhost/api/admin/map-features", {
      method: "POST", body: JSON.stringify({ ...stored, title: `Edited ${key}` }),
    }));
    expect(edited.status).toBe(200);
    expect((await getMapFeatures()).find((f) => f.id === feature.id)?.category).toBe(key);
  });

  it("retains existing icon keys and uses the safe info fallback for unknown input", () => {
    for (const [key, emoji] of [["beach", "🏖️"], ["viewpoint", "📸"], ["trailhead", "🥾"], ["park", "🌲"], ["shipwreck", "📍"], ["scarecrow", "🎃"]]) {
      expect(markerCategory(key).emoji).toBe(emoji);
    }
    for (const key of [undefined, "future-category", '<img src=x onerror="alert(1)">', "<script>alert(1)</script>", "javascript:alert(1)"]) {
      expect(markerCategory(key)).toMatchObject({ key: "info", emoji: "ℹ️" });
    }
    expect(new Set(MARKER_CATEGORIES.map((c) => c.key)).size).toBe(MARKER_CATEGORIES.length);
  });

  it("still rejects invalid marker coordinates without storing a feature", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/map-features", {
      method: "POST", body: JSON.stringify({ id: "test-invalid-outdoor", title: "Invalid", kind: "marker", category: "kayak", point: [0, 0], views: ["trails"] }),
    }));
    expect(response.status).toBe(400);
    expect((await getMapFeatures()).find((f) => f.id === "test-invalid-outdoor")).toBeUndefined();
  });
});
