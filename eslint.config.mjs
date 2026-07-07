import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // LINT-BASELINE (E02): pre-existing errors in frozen files, downgraded not fixed.
  // These ten client components error on unmodified `main` under exactly five rules.
  // Fixing them would change runtime behavior (deploy posture forbids it this epic),
  // so we downgrade the five rules to "warn" for ONLY these files — the occurrences
  // still print as warnings, and every other file + all other rules stay at error.
  // Policy: entries may only ever be REMOVED (when a later epic that owns a file
  // actually fixes it, delete that file from the list), never ADDED without an
  // explicit ask-first. See docs/TESTING.md.
  {
    files: [
      "src/app/admin/accounts/manager.tsx",
      "src/app/admin/map/editor.tsx",
      "src/app/admin/maps/editor.tsx",
      "src/app/ferry/ferry-board.tsx",
      "src/app/page.tsx",
      "src/app/portal/nonprofit/\\[id\\]/editor.tsx",
      "src/app/webcams/webcam-grid.tsx",
      "src/components/feature-map.tsx",
      "src/components/hunt-player.tsx",
      "src/components/visitor-survey.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
