import path from "path";
import { defineConfig } from "vitest/config";

// Unit config. Two first-class test homes (decisions §6b): the central
// `tests/unit/**` suites this epic (E02) adds, and the colocated `src/**/*.test.ts`
// suites E01 established — both run here. Server tests live in vitest.server.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    // Consolidated setup: unit-env.ts reuses E01's src/test/setup.ts (DATA_DIR +
    // AUTH_SECRET, captured before store modules import) and adds DB-backend hygiene.
    setupFiles: ["tests/setup/unit-env.ts"],
    // .tsx joins the glob for E14's component tests; those files opt into jsdom
    // per-file with a `// @vitest-environment jsdom` pragma, so the default
    // node environment above is unchanged for every existing suite.
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.ts"],
    // createTestDb boots an in-memory Postgres and applies every checked-in
    // migration (16 and counting) once per suite file. Under parallel load —
    // full-suite runs on a laptop that is also running a dev server or a
    // second agent session — the default 10s hook budget flakes on whichever
    // files lose the scheduling lottery (observed: 4-50 files per run, all
    // "Hook timed out", different files each time, every one green alone).
    // 30s is headroom, not slowness: a quiet boot takes well under a second.
    hookTimeout: 30_000,
    // Same problem, same headroom, for the tests that boot their database
    // INSIDE the `it()` rather than in a hook — createTestDb() in the test
    // body is the common shape here (analytics-k-floor, backup-restore,
    // pii-inventory), and repoWith() in control-bytes-guard is the same
    // scheduling lottery without a database. Those were left on vitest's 5s
    // default when hookTimeout was raised, so the flake simply moved from the
    // hooks to the bodies: 6-7 files per full run, "Test timed out in 5000ms"
    // every time, different files each run, every one green when run alone.
    testTimeout: 30_000,
    // The real cause of the flake, and why the timeouts above kept moving it
    // around rather than fixing it. Vitest defaults to one worker per core;
    // every worker that touches the data layer boots its own in-memory
    // Postgres. On an 8-core / 8GB machine that is eight databases at once —
    // observed load average 30 and ~200k pageouts, i.e. the machine swapping,
    // at which point whichever files lose the scheduling lottery time out.
    // Raising a timeout just lets a starved worker hold its slot longer.
    //
    // 4 binds only on machines with more than 4 cores, so it is a no-op on the
    // 4-core GitHub runner and a real cap on a developer laptop.
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // The real `server-only` throws outside a React Server bundle; the E05
      // data-layer suites import modules that carry it for build-time
      // poisoning. Swap in an empty stub under vitest.
      "server-only": path.resolve(__dirname, "tests/setup/server-only-stub.ts"),
    },
  },
});
