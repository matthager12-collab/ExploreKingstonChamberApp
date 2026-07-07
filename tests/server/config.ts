// Shared constants for the server test suite. Vitest globalSetup runs in a
// SEPARATE process from the test workers, so the port/URL cannot be handed over
// via env — both sides import these literals instead.
export const PORT = 3105;
export const BASE_URL = "http://127.0.0.1:3105";
