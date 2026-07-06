import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { dataPath } from "@/lib/data-dir";
import { surveyStore } from "@/lib/survey-store";

describe("survey-store crash guard", () => {
  it("skips a corrupt line instead of throwing", async () => {
    const file = dataPath("ltac-responses.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      [
        JSON.stringify({ submittedAt: "2026-01-01T00:00:00Z", distanceBand: "local" }),
        JSON.stringify({ submittedAt: "2026-01-02T00:00:00Z", distanceBand: "10-50mi" }),
        '{"distanceBand":"loc',
      ].join("\n") + "\n",
      "utf8",
    );

    const summary = await surveyStore.summarize();
    expect(summary.total).toBe(2);
  });
});
