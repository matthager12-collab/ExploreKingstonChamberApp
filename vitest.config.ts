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
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
