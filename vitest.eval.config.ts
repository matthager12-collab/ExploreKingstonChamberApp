import path from "path";
import { defineConfig } from "vitest/config";

// Live evaluation of member-page extraction. Run by hand with `npm run
// eval:member-page`; it calls the real model, so it is never part of `npm test`
// (vitest.config.ts includes only *.test.* files).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/eval/**/*.eval.ts"],
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/setup/server-only-stub.ts"),
    },
  },
});
