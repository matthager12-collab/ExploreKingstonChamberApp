// drizzle-kit config: `npm run db:generate` diffs src/lib/db/schema.ts against
// the checked-in migrations and emits new SQL under db/migrations/.
// `generate` needs no database; `db:migrate` (drizzle-kit migrate) and the
// boot-time programmatic migrator use DATABASE_URL.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
