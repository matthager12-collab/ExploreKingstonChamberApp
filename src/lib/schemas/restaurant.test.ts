// Restaurant schema: parity with the old sanitizeRestaurant + the client
// buildRecord it replaces (E07).

import { describe, expect, it } from "vitest";
import { firstZodMessage } from "./shared";
import { restaurantSchema } from "./restaurant";

const valid = {
  id: "the-grub-hut",
  name: "Grub Hut",
  cuisine: "Burgers",
  description: "Roadside burgers.",
  address: "123 Main St, Kingston, WA",
  priceLevel: 2,
  tags: ["quick", "takeout"],
  lat: 47.7973,
  lng: -122.4969,
  walkMinutesFromFerry: 5,
};

function errorOf(record: Record<string, unknown>): string {
  const result = restaurantSchema.safeParse(record);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return firstZodMessage(result.error);
}

describe("restaurantSchema", () => {
  it("parses a valid record and keeps every field", () => {
    const result = restaurantSchema.safeParse({
      ...valid,
      phone: "(360) 555-0100",
      website: "https://grubhut.example",
      menuUrl: "http://grubhut.example/menu",
      orderingUrl: "https://order.example",
      orderingPlatform: "toast",
      hours: "Daily 11-8",
      hoursVerified: "2026-07-01",
      hidden: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.orderingPlatform).toBe("toast");
    expect(result.data.hidden).toBe(true);
    expect(result.data.hoursVerified).toBe("2026-07-01");
  });

  it("omits empty optionals from the serialized record", () => {
    const result = restaurantSchema.parse({
      ...valid,
      phone: "",
      website: "",
      menuUrl: "",
      orderingUrl: "",
      orderingPlatform: "",
      hours: "",
      hidden: false,
    });
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    for (const key of [
      "phone",
      "website",
      "menuUrl",
      "orderingUrl",
      "orderingPlatform",
      "hours",
      "weeklyHours",
      "hoursVerified",
      "hidden",
    ]) {
      expect(Object.hasOwn(json, key), `${key} should be absent`).toBe(false);
    }
  });

  it("only `true` survives for hidden", () => {
    expect(restaurantSchema.parse({ ...valid, hidden: true }).hidden).toBe(true);
    const json = JSON.parse(JSON.stringify(restaurantSchema.parse({ ...valid, hidden: false })));
    expect(Object.hasOwn(json, "hidden")).toBe(false);
  });

  it("accepts numeric strings for the number fields", () => {
    const result = restaurantSchema.parse({
      ...valid,
      priceLevel: "2",
      lat: "47.7973",
      lng: "-122.4969",
      walkMinutesFromFerry: "5.4",
    });
    expect(result.priceLevel).toBe(2);
    expect(result.lat).toBe(47.7973);
    expect(result.walkMinutesFromFerry).toBe(5); // rounded, like the old Math.round(num())
  });

  it("strips unknown keys instead of rejecting them", () => {
    const result = restaurantSchema.parse({ ...valid, stray: "ignore-me" });
    expect(Object.hasOwn(result, "stray")).toBe(false);
  });

  it("rejects with the exact operator-facing messages", () => {
    expect(errorOf({ ...valid, id: "-bad" })).toBe(
      "id required: letters, numbers, and dashes (max 64 chars)",
    );
    expect(errorOf({ ...valid, name: " " })).toBe("name required");
    expect(errorOf({ ...valid, cuisine: "" })).toBe("cuisine required");
    expect(errorOf({ ...valid, address: "" })).toBe("address required");
    expect(errorOf({ ...valid, priceLevel: 4 })).toBe("priceLevel must be 1, 2, or 3");
    expect(errorOf({ ...valid, lat: 91 })).toBe("lat must be between -90 and 90");
    expect(errorOf({ ...valid, lng: -181 })).toBe("lng must be between -180 and 180");
    expect(errorOf({ ...valid, walkMinutesFromFerry: 121 })).toBe(
      "walk minutes must be a number between 0 and 120",
    );
    expect(errorOf({ ...valid, orderingPlatform: "grubhub" })).toBe(
      "orderingPlatform must be one of: toast, square, doordash, own-site, phone-only",
    );
  });

  it("rejects invalid optional URLs instead of silently dropping them (E07 behavior change)", () => {
    expect(errorOf({ ...valid, website: "foo" })).toBe("website must be an http(s) URL");
    expect(errorOf({ ...valid, menuUrl: "ftp://x" })).toBe("menuUrl must be an http(s) URL");
    expect(errorOf({ ...valid, orderingUrl: "x" })).toBe("orderingUrl must be an http(s) URL");
  });
});
