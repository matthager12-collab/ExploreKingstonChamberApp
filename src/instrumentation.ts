// Server startup hooks: Postgres migrations (E05) + server-side error
// monitoring (Sentry, E03 — off by default, no-op when SENTRY_DSN is unset).
// PII floor: sendDefaultPii is false and tracesSampleRate is 0 — no visitor
// IPs, cookies, request bodies, or performance traces leave this process.
// Client-side Sentry and source-map upload are explicitly out of scope (E03).

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Apply pending db/migrations before the server takes traffic — no-op when
  // DATABASE_URL is unset. Dynamic import per the installed docs
  // (node_modules/next/dist/docs/.../instrumentation.md): keeps pg/drizzle
  // out of the edge invocation of register().
  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();

  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

export const onRequestError: typeof Sentry.captureRequestError = (
  error,
  request,
  context,
) => {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureRequestError(error, request, context);
};
