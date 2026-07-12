// Dependency-cruiser boundary rules (E02, decisions §6b). Run by
// `npm run lint:boundaries` (depcruise --config .dependency-cruiser.cjs src) in CI.
//
// Codifies the layering the architecture relies on:
//   - no circular dependencies anywhere in src/**;
//   - src/lib/** (the shared, framework-agnostic core) must not import route/page
//     code (src/app/**) or UI components (src/components/**);
//   - src/components/** must not import route/page code (src/app/**).
//
// Baseline policy (shrink-only, same as the lint baseline): where today's code
// already crosses a boundary, the violation is carved out with a commented
// `pathNot` exception rather than refactored. Exceptions may only be REMOVED
// (when an epic that owns the code fixes it), never widened without an ask-first.
// Later epics EXTEND these rules; they do not re-create this file.

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make modules impossible to load/test in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-not-to-app",
      severity: "error",
      comment: "src/lib is the shared core — it must not depend on route/page code (src/app).",
      from: { path: "^src/lib/" },
      to: { path: "^src/app/" },
    },
    {
      name: "lib-not-to-components",
      severity: "error",
      comment:
        "src/lib must not depend on UI components. " +
        "BASELINE: src/lib/copy-context.tsx imports @/components/rich-text (the client copy " +
        "provider renders RichText). Pre-existing; carve-out until the copy layer is refactored.",
      from: { path: "^src/lib/" },
      to: {
        path: "^src/components/",
        pathNot: "^src/components/rich-text",
      },
    },
    {
      name: "components-not-to-app",
      severity: "error",
      comment:
        "Reusable components must not depend on route/page code (src/app). " +
        "BASELINE: src/components/ferry-webcams-box.tsx imports src/app/webcams/webcam-grid.tsx " +
        "(the box embeds that page's client grid). Pre-existing; carve-out until it's refactored " +
        "into a shared component — remove this pathNot when that lands.",
      from: { path: "^src/components/" },
      to: {
        path: "^src/app/",
        pathNot: "^src/app/webcams/webcam-grid",
      },
    },
    {
      name: "db-client-only-via-db-layer",
      severity: "error",
      comment:
        "E05: the Postgres client (src/lib/db/client.ts) is data-layer-only — " +
        "every other APP module goes through src/lib/db/records.ts or a store " +
        "module. Resolver-aware twin of the eslint no-restricted-imports rule " +
        "(this one also catches aliased/relative specifiers). tests/ is exempt: " +
        "the PGlite harness (tests/setup/pglite-db.ts) IS the sanctioned " +
        "injection seam and is never shipped.",
      from: { pathNot: "^src/lib/db/|^tests/" },
      to: { path: "^src/lib/db/client" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
