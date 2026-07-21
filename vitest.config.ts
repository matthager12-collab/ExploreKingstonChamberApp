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
