// Boots the standalone production server once for the whole server-test run.
//
// Why standalone and not `next dev`: next.config.ts sets output:"standalone", so
// `next start` refuses to run; the shipped entrypoint is `node server.js` at the
// root of .next/standalone after the Dockerfile's asset copies. We reproduce that
// here so the walk + axe suites exercise exactly what deploys.

import { spawn, type ChildProcess } from "child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { BASE_URL, PORT } from "./config";

// E06: imported, no longer hand-copied. This file used to reproduce scrypt
// hashing in-process because src/lib/auth.ts imported next/headers at module
// scope and could not be loaded here — two implementations that had to stay in
// sync or every server test would authenticate against a hash the app rejects.
// src/lib/auth/tokens.ts is pure (no next/headers, no DB), so it loads fine in
// a plain-Node globalSetup.
import { hashPassword } from "../../src/lib/auth/tokens";

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

  // E05: structured data lives in Postgres — the server tier needs a REAL,
  // THROWAWAY database. It must come from the explicit TEST_DATABASE_URL (CI:
  // the postgres:16 service container; locally: `docker run postgres:16` or a
  // Neon dev branch). The parent's DATABASE_URL is still deliberately ignored
  // so an operator shell can never point tests at real Neon — same hygiene as
  // before, now with an explicit opt-in var. The setup migrates the schema
  // (same checked-in db/migrations the boot migrator uses), WIPES record/
  // audit/quarantine, and seeds the admin into the auth-users store.
  const testDbUrl = process.env.TEST_DATABASE_URL;
  if (!testDbUrl) {
    throw new Error(
      "Server tests require TEST_DATABASE_URL (a THROWAWAY Postgres — CI uses a " +
        "postgres:16 service; locally: docker run -e POSTGRES_PASSWORD=ci -p 5432:5432 postgres:16 " +
        "then TEST_DATABASE_URL=postgres://postgres:ci@127.0.0.1:5432/postgres).",
    );
  }

  // E06: accounts live in the `users` table, not a record-store doc.
  const admin = {
    id: "ci-admin",
    email: "ci@example.test",
    name: "CI Admin",
    role: "admin",
    passwordHash: hashPassword("ci-admin-password"),
  };

  {
    const pool = new Pool({ connectionString: testDbUrl, max: 1 });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: path.join(root, "db", "migrations") });
    // TRUNCATE deliberately: row triggers (audit immutability) don't fire on
    // TRUNCATE, and a test DB must start empty. Safe only because this is the
    // explicit TEST_DATABASE_URL.
    await db.execute(sql`TRUNCATE record, audit, quarantine, users, invites, orgs`);
    // org_id stays NULL: admin is a Chamber-staff role, and users_org_binding
    // rejects a staff row that carries an org.
    await db.execute(sql`
      INSERT INTO users (id, email, name, role, password_hash)
      VALUES (${admin.id}, ${admin.email}, ${admin.name}, ${admin.role}, ${admin.passwordHash})
    `);
    await pool.end();
  }

  // Fresh scratch DATA_DIR: photos and the health route's write probe are
  // still disk-backed. Auth is Postgres-only — the admin was seeded into the
  // auth-users store above, not into any users.json.
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "vk-server-test-"));

  // Child env: inherit the parent's, but pin DATABASE_URL to the test DB and
  // STRIP UPSTASH_* (never real Redis). Then set the standalone runtime knobs.
  const env: Record<string, string | undefined> = { ...process.env };
  env.DATABASE_URL = testDbUrl;
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
