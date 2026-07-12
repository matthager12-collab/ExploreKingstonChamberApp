// Vitest stand-in for the `server-only` package (aliased in vitest.config.ts).
// The real package throws when evaluated outside a React Server bundle — which
// is exactly right in the app and exactly wrong in node-environment unit
// tests. The data layer under test imports it for build-time poisoning only.
export {};
