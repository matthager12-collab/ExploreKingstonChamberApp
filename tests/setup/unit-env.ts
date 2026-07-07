// Consolidated unit-test environment (E02). This is the single setupFile for
// vitest.config.ts. It reuses E01's src/test/setup.ts for the load-order-critical
// bit — establishing a scratch DATA_DIR and an AUTH_SECRET *before* any src/ store
// module is imported (stores freeze their file paths at import time via
// dataPath()/dataDir()) — then adds the store-backend hygiene E02 needs.
//
// The import below runs for its side effects (DATA_DIR mkdtemp + AUTH_SECRET). It
// MUST stay first so those env vars exist before test files import stores/auth.
import "@/test/setup";

// Force the FILE backend for every store: hasDb() in src/lib/db.ts keys off
// DATABASE_URL, and the Upstash rate-limiter keys off these two. An operator shell
// that happens to export any of them must never point unit tests at real Neon/Redis.
delete process.env.DATABASE_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// Belt-and-suspenders: guarantee an AUTH_SECRET even if src/test/setup.ts changes.
// secret() in src/lib/auth.ts throws when it is unset.
process.env.AUTH_SECRET ??= "vitest-only-secret";
