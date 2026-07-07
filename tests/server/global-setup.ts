// Boots the standalone production server once for the whole server-test run.
//
// Why standalone and not `next dev`: next.config.ts sets output:"standalone", so
// `next start` refuses to run; the shipped entrypoint is `node server.js` at the
// root of .next/standalone after the Dockerfile's asset copies. We reproduce that
// here so the walk + axe suites exercise exactly what deploys.

import { spawn, type ChildProcess } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { randomBytes, scryptSync } from "crypto";
import os from "os";
import path from "path";
import { BASE_URL, PORT } from "./config";

// Mirrors src/lib/auth.ts hashPassword (format `scrypt$<salt>$<hash>`). Reproduced
// in-process rather than imported because src/lib/auth.ts imports next/headers at
// module scope, which we must not load in a plain-Node globalSetup context.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export default async function setup() {
  const root = process.cwd();
  const standaloneDir = path.join(root, ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  if (!existsSync(serverJs)) {
    throw new Error(
      "Server tests require the standalone build — run `npm run build` first " +
        `(missing ${path.relative(root, serverJs)}).`,
    );
  }

  // Standalone output omits public/ and .next/static — copy them to where
  // server.js serves them from (the Dockerfile runner stage does the same).
  const staticSrc = path.join(root, ".next", "static");
  if (existsSync(staticSrc)) {
    cpSync(staticSrc, path.join(standaloneDir, ".next", "static"), { recursive: true });
  }
  const publicSrc = path.join(root, "public");
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, path.join(standaloneDir, "public"), { recursive: true });
  }

  // Fresh scratch DATA_DIR seeded with one admin user. Seeding a user puts the
  // server in production posture: the pre-setup grace window is closed and
  // POST /api/auth/setup is locked (403) — which the walk test asserts.
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "vk-server-test-"));
  const authDir = path.join(dataDir, "auth");
  mkdirSync(authDir, { recursive: true });
  const admin = {
    id: "ci-admin",
    email: "ci@example.test",
    name: "CI Admin",
    role: "admin",
    linkedIds: [] as string[],
    passwordHash: hashPassword("ci-admin-password"),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path.join(authDir, "users.json"), JSON.stringify([admin], null, 2), "utf8");

  // Child env: inherit the parent's, but STRIP DATABASE_URL/UPSTASH_* so an
  // operator shell that exports them can never point the server at real Neon/Redis
  // (same hygiene as tests/setup/unit-env.ts). Then set the standalone runtime knobs.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.DATABASE_URL;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  env.PORT = String(PORT);
  env.HOSTNAME = "127.0.0.1";
  env.DATA_DIR = dataDir;
  env.AUTH_SECRET = "vitest-only-secret";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.NODE_ENV = "production";

  const child: ChildProcess = spawn("node", ["server.js"], {
    cwd: standaloneDir,
    // env has NODE_ENV set above; ProcessEnv marks it required + readonly, hence the cast.
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  child.stdout?.on("data", (d) => (childLog += String(d)));
  child.stderr?.on("data", (d) => (childLog += String(d)));
  let exitCode: number | null = null;
  child.on("exit", (code) => (exitCode = code));

  // Poll GET /api/health until 200 (route write-probes DATA_DIR). 60s cap.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new Error(`Standalone server exited early (code ${exitCode}).\n${childLog}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      // server not accepting connections yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(`Standalone server did not become healthy within 60s.\n${childLog}`);
  }

  // Teardown: kill the server and remove the scratch data dir.
  return async () => {
    child.kill("SIGKILL");
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };
}
