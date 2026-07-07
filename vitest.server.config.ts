import path from "path";
import { defineConfig } from "vitest/config";

// Server config: boots the STANDALONE production build (node .next/standalone/server.js)
// once via globalSetup and runs the route-gating walk + axe smoke against it — testing
// what actually ships, not `next dev`. fileParallelism:false so both suites share the
// single server on the fixed port. Unit tests live in vitest.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/server/**/*.test.ts"],
    globalSetup: ["tests/server/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
