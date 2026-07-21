import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the production
  // Docker image ships only the files it needs — see Dockerfile / docs/DEPLOY.md.
  output: "standalone",
  // E13: a stale service worker is the worst PWA failure mode — a bad /sw.js
  // cached by the browser can outlive several deploys and keep serving old
  // pages with no way for a visitor to escape. Headers are matched BEFORE the
  // filesystem, including files under public/, so this reliably overrides
  // public/'s default `Cache-Control: public, max-age=0`.
  //
  // Works under output:"standalone" — headers resolve at BUILD time into
  // routes-manifest.json and the runtime router applies them ahead of the
  // static serve. Consequence: changing this needs a rebuild + redeploy, never
  // a Render restart (same class as the E09 "restart != env inject" lesson).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
