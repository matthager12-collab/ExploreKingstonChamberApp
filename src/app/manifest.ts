// PWA install manifest (E13). Next serves this file at /manifest.webmanifest
// with Content-Type: application/manifest+json and auto-injects the
// <link rel="manifest"> into every page — never hand-add one in layout.tsx,
// and never add a `manifest:` field to the metadata export there either.
//
// Unlike robots.ts this route takes no request-time input, so it is
// deliberately NOT `force-dynamic` — it prerenders once and is served static.
import type { MetadataRoute } from "next";

// Duplicated from src/app/layout.tsx, where the same string lives as a
// module-private `const DESCRIPTION`. Exporting a non-Next symbol from a layout
// is not something this repo does, so the literal is copied instead — if you
// edit one, edit both.
const DESCRIPTION =
  "Ferry times, restaurants, events, parking, and itineraries for Kingston, Washington — the gateway to the Kitsap Peninsula and Olympic National Park. The interactive companion to explorekingstonwa.com.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` pins the app identity across start_url changes — without it a later
    // edit to start_url reads as a *different* app and installs a duplicate.
    id: "/",
    name: "Explore Kingston",
    // Home-screen labels get truncated around 12 characters; "Kingston" is what
    // a visitor would look for under the icon anyway.
    short_name: "Kingston",
    description: DESCRIPTION,
    // Kept, but read nothing more into it than is there: `?source=pwa` shows up
    // in the hosting layer's HTTP access log when someone launches the installed
    // app, and that is the whole of it. Our OWN analytics never sees it —
    // <Tracker/> reports usePathname(), which is "/" with the query string
    // already stripped, and /api/track stores only that path. So do not answer
    // "how many opens come from the installed app?" from the tracker's numbers;
    // it cannot tell. Making it real would mean having Tracker report the
    // display mode directly (src/components/pwa.tsx already computes exactly
    // that in isInstalled()) — a possible follow-up, deliberately not built.
    start_url: "/?source=pwa",
    display: "standalone",
    // Both values are copies of existing tokens, not new colors:
    // background_color = --color-shell (globals.css), theme_color is
    // byte-identical to the `themeColor` viewport export in layout.tsx so the
    // browser chrome and the installed app can never disagree.
    background_color: "#fbfcfd",
    theme_color: "#1E96C0",
    // MetadataRoute.Manifest types `purpose` as a SINGLE value — the
    // space-separated "any maskable" the web spec allows will not typecheck.
    // Hence a separate maskable entry rather than a combined purpose.
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
