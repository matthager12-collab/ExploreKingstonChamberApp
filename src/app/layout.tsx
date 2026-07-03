import type { Metadata, Viewport } from "next";
import { Poppins, Roboto, Roboto_Slab, Satisfy } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Tracker } from "@/components/tracker";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-roboto",
});
const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-roboto-slab",
});
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-poppins",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoSlab.variable} ${poppins.variable} ${satisfy.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Tracker />
        <SiteNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
