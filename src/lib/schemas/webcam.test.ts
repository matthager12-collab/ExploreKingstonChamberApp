// Webcam schema: parity with the old sanitizeWebcam (E07).

import { describe, expect, it } from "vitest";
import { firstZodMessage } from "./shared";
import { webcamSchema } from "./webcam";

const valid = {
  id: "kingston-dock",
  name: "Kingston Dock",
  location: "SR 104 at the ferry dock",
  imageUrl: "https://images.wsdot.wa.gov/kingston.jpg",
  sourceUrl: "https://wsdot.com/ferries/cameras",
  source: "WSDOT",
  refreshSeconds: 60,
};

function errorOf(record: Record<string, unknown>): string {
  const result = webcamSchema.safeParse(record);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return firstZodMessage(result.error);
}

describe("webcamSchema", () => {
  it("parses a valid record and round-trips it", () => {
    expect(webcamSchema.parse(valid)).toEqual(valid);
  });

  it("requires both URLs with the exact messages", () => {
    expect(errorOf({ ...valid, imageUrl: "" })).toBe(
      "imageUrl must be an http(s) URL to a still image",
    );
    expect(errorOf({ ...valid, imageUrl: "wsdot.wa.gov/cam.jpg" })).toBe(
      "imageUrl must be an http(s) URL to a still image",
    );
    expect(errorOf({ ...valid, sourceUrl: "" })).toBe(
      "sourceUrl must be an http(s) URL (credit/link-back page)",
    );
  });

  it("bounds refreshSeconds at 15 and 3600 with the exact message", () => {
    expect(errorOf({ ...valid, refreshSeconds: 14 })).toBe(
      "refreshSeconds must be a number between 15 and 3600",
    );
    expect(errorOf({ ...valid, refreshSeconds: 3601 })).toBe(
      "refreshSeconds must be a number between 15 and 3600",
    );
    expect(webcamSchema.parse({ ...valid, refreshSeconds: "60" }).refreshSeconds).toBe(60);
    expect(webcamSchema.parse({ ...valid, refreshSeconds: 59.6 }).refreshSeconds).toBe(60);
  });

  it("location and source may be empty (they coerce to \"\")", () => {
    const result = webcamSchema.parse({ ...valid, location: undefined, source: undefined });
    expect(result.location).toBe("");
    expect(result.source).toBe("");
  });
});
