import Image from "next/image";
import Link from "next/link";
import { copyText } from "@/lib/stores/site-store";
import { RichText } from "@/components/rich-text";

const planLinks = [
  { href: "/ferry", label: "Ferry schedules" },
  { href: "/parking", label: "Parking" },
  { href: "/webcams", label: "Webcams" },
  { href: "/itineraries", label: "Itineraries" },
  // E14: the plain-language page. Hideable like the rest, so it goes through
  // the same hiddenPaths filter below — a visitor never sees a link to a 404.
  { href: "/simple", label: "Kingston basics" },
];

/** `tel:` href for a printed-style number ("360-860-2239" → "tel:+13608602239"). */
function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

// E14 (FR-92): the Spanish page, labelled in Spanish and marked lang="es" so a
// screen reader says it in Spanish. It goes through the SAME hiddenPaths filter
// as everything else, and /es is default-hidden — so this link simply is not
// rendered until an operator unhides the page after the bilingual review
// (docs/OPERATIONS.md, "Accessibility & language").
const languageLinks = [{ href: "/es", label: "Kingston en español", lang: "es" }];

const communityLinks = [
  { href: "/events", label: "Events calendar" },
  { href: "/give", label: "Volunteer & give back" },
  { href: "/hunt", label: "Scavenger hunt" },
  { href: "/about", label: "About this site" },
];

export function SiteFooter({
  hiddenPaths = [],
  copy = {},
}: {
  hiddenPaths?: string[];
  copy?: Record<string, string>;
}) {
  // Admin-hidden pages drop out of the footer lists too.
  const plan = planLinks.filter((l) => !hiddenPaths.includes(l.href));
  const community = communityLinks.filter((l) => !hiddenPaths.includes(l.href));
  const languages = languageLinks.filter((l) => !hiddenPaths.includes(l.href));
  const phone = copyText(copy, "contact.phone.number");
  return (
    // print:hidden (E14): chrome is noise on paper — /print is the curated
    // one-pager and carries its own copy of these phone numbers.
    <footer className="mt-12 bg-sound-deep text-white print:hidden">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          {/* Stacked logo is black-on-transparent, so it sits on a white chip */}
          <a
            href="https://explorekingstonwa.com"
            className="inline-block rounded-xl bg-white p-2.5"
          >
            <Image
              src="/brand/logo-explore-kingston-alt.png"
              alt="Explore Kingston"
              width={549}
              height={435}
              className="h-16 w-auto"
            />
          </a>
          <p className="font-display mt-3 text-lg font-semibold">
            {copyText(copy, "footer.brand")}
          </p>
          <p className="mt-2 text-sm text-seaglass">
            {/* E14: on-navy tone — the default link colour is 2.41:1 here. */}
            <RichText tone="dark" text={copyText(copy, "footer.tagline")} />
          </p>
          {/* E14 (M-18-07 / FR-47): the always-reachable human fallback, on
              every page. White on sound-deep is 12.7:1, and the number is
              visible text as well as a tel: target so it can be read aloud,
              copied, or written down by someone who will not tap it. */}
          <p className="mt-4 text-base">
            <a
              href={telHref(phone)}
              className="inline-flex min-h-11 items-center font-semibold text-white underline underline-offset-2"
            >
              {copyText(copy, "contact.phone.label")}: {phone}
            </a>
          </p>
        </div>
        <div>
          <p className="font-nav text-sm font-semibold tracking-widest text-seaglass uppercase">Plan</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {plan.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:underline">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-nav text-sm font-semibold tracking-widest text-seaglass uppercase">Community</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {community.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:underline">{l.label}</Link>
              </li>
            ))}
            {languages.map((l) => (
              <li key={l.href}>
                <Link href={l.href} lang={l.lang} className="hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
            <li><Link href="/portal" className="font-medium hover:underline">Chamber &amp; business portal →</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-4 text-xs text-seaglass/80 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <RichText tone="dark" text={copyText(copy, "footer.credit")} />
          </p>
          {/* Conspicuous on every page (MHMDA: notice linked from the home surface). */}
          <nav aria-label="Legal" className="flex gap-4">
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/accessibility" className="hover:underline">
              Accessibility
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
