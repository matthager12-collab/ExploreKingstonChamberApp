import fs from "node:fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync("src/app/globals.css", "utf8");
function token(name: string): number[] {
  const hex = css.match(new RegExp(`--color-${name}:\\s*([#][\\da-f]{6})`, "i"))?.[1];
  if (!hex) throw new Error(`Missing theme token: ${name}`);
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}
function luminance(rgb: number[]): number {
  const channels = rgb.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
describe("boarding-pass banner contrast", () => {
  it.each([["white", [255, 255, 255]], ["seaglass", token("seaglass")]] as const)("%s text meets AA on the actual navy token", (_, rgb) => {
    const a = luminance([...rgb]); const b = luminance(token("sound-deep"));
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it("the primary directions action keeps AA text contrast", () => {
    const a = luminance([255, 255, 255]); const b = luminance(token("coral"));
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
