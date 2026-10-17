import { describe, expect, it } from "vitest";
import {
  cliArgs,
  buildPrompt,
} from "../../scripts/chamber-research-worker.mjs";
describe("CLI research isolation", () => {
  it("restricts built-in tools and denies every MCP tool", () => {
    const args = cliArgs();
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("mcp__*");
    expect(args).toContain("--safe-mode");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
  it("carries revisions and requires sources without granting publication", () => {
    const prompt = buildPrompt(
      {
        payload: {
          prompt: "Find a park",
          links: [],
          feedback: ["Skip the beach"],
          drafts: [],
        },
      },
      { now: "2026-10-17" },
    );
    expect(prompt).toContain("Skip the beach");
    expect(prompt).toContain("Never publish");
    expect(prompt).toContain("Do not invent");
  });
});

import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchWithCli } from "../../scripts/chamber-research-worker.mjs";
it("runs a CLI subprocess without passing the portal token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chamber-cli-test-"));
  const priorPath = process.env.PATH,
    priorToken = process.env.CHAMBER_RESEARCH_TOKEN;
  try {
    const fake = join(dir, "claude");
    await writeFile(
      fake,
      '#!/usr/bin/env node\nlet input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{if(process.env.CHAMBER_RESEARCH_TOKEN)process.exit(9);process.stdout.write(JSON.stringify({structured_output:{summary:input.includes("Find a park")?"researched":"bad prompt",drafts:[]}}));});\n',
    );
    await chmod(fake, 0o700);
    process.env.PATH = `${dir}:${priorPath}`;
    process.env.CHAMBER_RESEARCH_TOKEN = "never-pass-this-token";
    const result = await researchWithCli(
      {
        payload: { prompt: "Find a park", links: [], feedback: [], drafts: [] },
      },
      { now: "2026-10-17" },
    );
    expect(result).toEqual({ summary: "researched", drafts: [] });
  } finally {
    process.env.PATH = priorPath;
    if (priorToken === undefined) delete process.env.CHAMBER_RESEARCH_TOKEN;
    else process.env.CHAMBER_RESEARCH_TOKEN = priorToken;
    await rm(dir, { recursive: true, force: true });
  }
});
