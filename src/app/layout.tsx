import type { Metadata, Viewport } from "next";
import { Inter, Outfit, Satisfy } from "next/font/google";
import "./globals.css";
import { ServiceWorkerClient } from "@/components/pwa";
import { siteUrl } from "@/lib/site-url";

// THE ROOT LAYOUT — deliberately holds only what BOTH route groups need.
//
// E22 moved the site chrome (nav, footer, Tracker, CopyProvider, the skip link,
// the offline banner) down into src/app/(site)/layout.tsx via
// src/components/site-chrome.tsx, so that src/app/(kiosk)/layout.tsx can render
// a genuinely bare fullscreen stage. A descendant layout cannot remove chrome
// an ancestor renders, so the chrome had to move rather than be hidden — and
// hiding it conditionally here was rejected outright, because a pathname read
// in the root layout means headers(), and a dynamic API here opts EVERY page
// out of static rendering (docs/KIOSK.md §2).
//
// What is left, and why each piece cannot move down:
//   - <html>/<body> and the three font CSS variables: only the root layout
//     renders these elements at all, and both groups style against the vars.
//   - globals.css: the design tokens, imported once.
//   - viewport / metadata / metadataBase: the site-wide defaults. The kiosk
//     layout exports its own viewport, which MERGES over this one.
//   - the simple-mode bootstrap: it stamps documentElement before paint, so it
//     has to be inline in the root document.
//   - <ServiceWorkerClient/>: the kiosk's offline tolerance is this same
//     worker, so registration lives here while the offline BANNER stays in the
//     site chrome.
//
// The <body> flex-column classes stay here on purpose. Only the root layout can
// set them, the site's `flex-1` <main> depends on them, and they cost the kiosk
// nothing: its stage is position:fixed and therefore out of flow entirely.

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-outfit",
});
const satisfy = Satisfy({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-satisfy",
});

// Set NEXT_PUBLIC_SITE_URL to the deployed origin so shared-link cards and the
// OG image resolve to absolute URLs. Dev falls back to localhost (fine — no
// social scraper hits dev). Shared with sitemap.ts and robots.ts via
// siteUrl() so all three advertise the SAME origin.
const SITE_URL = siteUrl();

const DESCRIPTION =
  "Ferry times, restaurants, events, parking, and itineraries for Kingston, Washington — gateway to the Kitsap Peninsula and Olympic National Park.";

export const viewport: Viewport = {
  // Extend under the iOS home indicator so the bottom nav can use its inset.
  viewportFit: "cover",
  themeColor: "#1E96C0",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Explore Kingston — Kingston, Washington",
    template: "%s · Explore Kingston",
  },
  description: DESCRIPTION,
  // This app spreads by visitors texting links — give every share a real card.
  openGraph: {
    type: "website",
    siteName: "Explore Kingston",
    title: "Explore Kingston — Kingston, Washington",
    description: DESCRIPTION,
    images: [
      {
        url: "/brand/photo-hansville-hero.jpg",
        width: 1024,
        height: 683,
        alt: "Point No Point across Puget Sound near Kingston, Washington",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Explore Kingston — Kingston, Washington",
    description: DESCRIPTION,
    images: ["/brand/photo-hansville-hero.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} ${satisfy.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* E14 simple-mode bootstrap (vk/simple-mode). Runs before paint so the
            larger "easy read" type never flashes at the default size. State is
            localStorage + a data-simple attribute BY DESIGN: a cookies() read in
            the root layout would make every page dynamic (the audited v1 ISR
            trap), so this stays a raw inline <script>, not next/script and not a
            server read. try/catch because Safari private mode throws on any
            localStorage access. Reading an absent key is a no-op, which is what
            keeps it harmless in the kiosk group — the kiosk renders no toggle,
            and its Chromium runs --incognito, so the key is never set there. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("ek-simple")==="1"){document.documentElement.dataset.simple="1"}}catch(e){}`,
          }}
        />
        <ServiceWorkerClient />
        {children}
      </body>
    </html>
  );
}
