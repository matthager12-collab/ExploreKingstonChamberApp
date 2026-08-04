import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the production
  // Docker image ships only the files it needs — see Dockerfile / docs/DEPLOY.md.
  output: "standalone",
  // NOTE (2026-08-01, perf/home-lcp-headroom): experimental.inlineCss was
  // measured here and REJECTED. It removes the stylesheet request, but the
  // document grew 26KB → 64KB transfer (the RSC flight payload embeds the CSS
  // text a second time for client-side navigation), and simulated mobile FCP
  // regressed 905ms → 1004ms while LCP barely moved. Don't re-try it without
  // re-measuring.
  // The default `x-powered-by: Next.js` leaks the framework on every response
  // for zero benefit — drop it.
  poweredByHeader: false,
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
      // Site-wide security headers (prod served none of these as of
      // 2026-07-31, curl-verified). Both rules match /sw.js; the keys are
      // disjoint so the sets combine rather than override.
      {
        source: "/(.*)",
        headers: [
          // Deliberately NO `preload` and NO `includeSubDomains`: the apex
          // explorekingstonwa.com stays on WordPress/NameHero, and the other
          // subdomains are not ours to commit to HTTPS. 180 days.
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // geolocation MUST stay `self`: the side-switcher, near-me sort, and
          // hunt check-ins all call navigator.geolocation.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=()",
          },
          // Report-Only, NOT enforced: launch is days away and kiosk / map
          // editors / admin are too many surfaces to enforce untested —
          // flipping this to Content-Security-Policy is a post-launch task.
          // Why each carve-out exists:
          //   - script-src 'unsafe-inline': RSC/Next bootstrap inline scripts
          //     and the JSON-LD component render inline <script> tags.
          //   - style-src 'unsafe-inline': MapLibre injects style elements.
          //   - worker-src blob:: MapLibre spawns its workers from blob: URLs.
          //   - img-src data: blob: https://images.wsdot.wa.gov: map sprites/
          //     canvases plus the WSDOT webcams hotlinked by
          //     src/lib/data/webcams.ts.
          //   - *.arcgisonline.com (img-src AND connect-src): the /parking
          //     satellite base layer — the single third-party tile source in
          //     the app (ADR-0006 amendment 1, see SATELLITE_TILE_URL in
          //     src/lib/map/basemap.ts). BOTH directives are required because
          //     MapLibre fetches raster tiles with fetch() and then paints
          //     them through an <img>/ImageBitmap. Vector pmtiles and glyphs
          //     remain same-origin from /api/map/tiles/* and /fonts/*.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://images.wsdot.wa.gov https://services.arcgisonline.com",
              "connect-src 'self' https://services.arcgisonline.com",
              "worker-src 'self' blob:",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
