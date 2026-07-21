// E15 slice 4 — the cron inventory is an invariant, not a list.
//
// The failure this guards actually happened: a cron hitting an /api/admin
// route that is missing from src/proxy.ts's MACHINE_TOKEN_ROUTES is rejected
// no matter how correct its token is, and the only symptom is a job that
// quietly stops working. Nightly backups broke that way once.
//
// It also pins the Actions-vs-Render split so a future edit cannot silently
// re-home a job (or schedule the retention purge, which ships dark).

import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const renderYaml = readFileSync(path.join(ROOT, "render.yaml"), "utf8");
const proxySrc = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");

/** Minimal, dependency-free read of the cron blocks in render.yaml. */
function renderCrons(): Array<{ name: string; schedule: string; command: string }> {
  const out: Array<{ name: string; schedule: string; command: string }> = [];
  // Split on service entries, keep the ones declaring `type: cron`.
  for (const block of renderYaml.split(/\n\s{2}- type:\s*/).slice(1)) {
    if (!block.startsWith("cron")) continue;
    const name = /\n\s+name:\s*(\S+)/.exec(block)?.[1] ?? "";
    const schedule = /\n\s+schedule:\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    // dockerCommand is a folded block; take everything up to the next key.
    const cmd = /dockerCommand:\s*>-\s*\n([\s\S]*?)(?=\n\s{4}\w+:)/.exec(block)?.[1] ?? "";
    out.push({ name, schedule, command: cmd.replace(/\s+/g, " ").trim() });
  }
  return out;
}

function machineTokenRoutes(): string[] {
  const table = /const MACHINE_TOKEN_ROUTES[\s\S]*?\{([\s\S]*?)\};/.exec(proxySrc)?.[1] ?? "";
  return [...table.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
}

const crons = renderCrons();

describe("Render cron services", () => {
  it("declares every app cron that used to live on GitHub Actions", () => {
    const names = crons.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["events-ingest", "ferry-observe", "ferry-accuracy", "worklist-sweep"]),
    );
  });

  it("gives each cron a valid 5-field schedule", () => {
    for (const c of crons) {
      expect(c.schedule.trim().split(/\s+/), `${c.name} schedule "${c.schedule}"`).toHaveLength(5);
    }
  });

  it("authenticates every cron with a token from its own env block", () => {
    for (const c of crons) {
      expect(c.command, `${c.name} sends no Authorization header`).toContain("Authorization: Bearer");
      expect(c.command, `${c.name} does not interpolate a token`).toMatch(/\$[A-Z_]+/);
    }
  });

  it("only ever calls /api/admin routes that the proxy can authorise", () => {
    // THE regression guard. A path missing from MACHINE_TOKEN_ROUTES is
    // rejected regardless of the token, and the job just stops working.
    const allowed = machineTokenRoutes();
    for (const c of crons) {
      const adminPath = /https:\/\/[^\s]*(\/api\/admin\/[^\s"']*)/.exec(c.command)?.[1];
      if (!adminPath) continue;
      expect(
        allowed,
        `${c.name} calls ${adminPath}, which is NOT in src/proxy.ts MACHINE_TOKEN_ROUTES — ` +
          `it would be rejected no matter how correct the token is`,
      ).toContain(adminPath);
    }
  });
});

describe("GitHub Actions workflows", () => {
  const dir = path.join(ROOT, ".github/workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  const scheduled = files.filter((f) =>
    /^\s*-\s*cron:/m.test(readFileSync(path.join(dir, f), "utf8")),
  );

  it("never leaves an app cron running ONLY on Actions", () => {
    // Holds in both phases of the migration, which is the point: during the
    // deliberate overlap a job may be scheduled in both places (harmless —
    // /api/ferry/observe dedupes server-side ~10 min, and the daily/weekly
    // jobs are recomputations), and after the Actions workflows are deleted
    // this is trivially satisfied. What it forbids is the state that would
    // silently rot: a scheduled workflow with no Render counterpart, waiting
    // for GitHub's 60-day inactivity rule to switch it off unannounced.
    //
    // backup-offsite is the one permitted exception: it installs `age` and
    // encrypts on the runner, so moving it would put the backup keypair inside
    // the app's own image — the one thing a backup must survive.
    const renderCronNames = new Set(crons.map((c) => c.name));
    const orphaned = scheduled
      .map((f) => f.replace(/\.yml$/, ""))
      .filter((name) => name !== "backup-offsite" && !renderCronNames.has(name));

    expect(
      orphaned,
      `these workflows are scheduled on Actions with no Render cron of the same name: ` +
        `${orphaned.join(", ")} — they will silently stop after 60 quiet days`,
    ).toEqual([]);
  });

  it("keeps the privacy-retention purge DARK (no schedule)", () => {
    const src = readFileSync(path.join(dir, "privacy-retention.yml"), "utf8");
    // Its APPLY flag is `inputs.apply || event_name == schedule`, so ANY
    // schedule here makes it start really deleting. Enabling the purge is an
    // owner decision (E11), never a side effect of a cron migration.
    expect(/^\s*-\s*cron:/m.test(src), "privacy-retention must not be scheduled").toBe(false);
  });
});
