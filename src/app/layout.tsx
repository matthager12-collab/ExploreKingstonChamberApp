import type { Metadata, Viewport } from "next";
import { Inter, Outfit, Satisfy } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Tracker } from "@/components/tracker";
import { getCopyOverrides } from "@/lib/stores/site-store";
import { getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { CopyProvider } from "@/lib/copy-context";

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
// social scraper hits dev).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const DESCRIPTION =
  "Ferry times, restaurants, events, parking, and itineraries for Kingston, Washington — the gateway to the Kitsap Peninsula and Olympic National Park. The interactive companion to explorekingstonwa.com.";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Admin-hidden pages drop out of the nav and footer site-wide; admin copy
  // overrides are provided to client components via CopyProvider (server
  // components read them directly with copyText()).
  //
  // E14: the EFFECTIVE list, so a default-hidden page (/es, dark until a
  // bilingual reviewer signs off) never appears as a footer link to a 404. This
  // is a plain store read — it touches no cookies, so the layout stays out of
  // the ISR trap the skip-link comment below describes.
  const [hiddenPaths, copyOverrides] = await Promise.all([
    getEffectiveHiddenPaths(),
    getCopyOverrides(),
  ]);
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} ${satisfy.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* E14: the skip link is deliberately the first element in <body> so it is
            the first thing Tab reaches — keyboard and switch users clear the whole
            header/nav in one keystroke. sr-only until focused, then a full-size
            (>=44px) brand-token chip so sighted keyboard users can see it too. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-sound-deep focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        {/* E14 simple-mode bootstrap (vk/simple-mode). Runs before paint so the
            larger "easy read" type never flashes at the default size. State is
            localStorage + a data-simple attribute BY DESIGN: a cookies() read in
            the root layout would make every page dynamic (the audited v1 ISR
            trap), so this stays a raw inline <script>, not next/script and not a
            server read. try/catch because Safari private mode throws on any
            localStorage access. The toggle that writes the key lands in a later
            E14 slice; reading an absent key is a no-op. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("ek-simple")==="1"){document.documentElement.dataset.simple="1"}}catch(e){}`,
          }}
        />
        <CopyProvider overrides={copyOverrides}>
          <Tracker />
          <SiteNav hiddenPaths={hiddenPaths} />
          {/* id="main" is the skip link's target (E14). */}
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter hiddenPaths={hiddenPaths} copy={copyOverrides} />
        </CopyProvider>
      </body>
    </html>
  );
}
