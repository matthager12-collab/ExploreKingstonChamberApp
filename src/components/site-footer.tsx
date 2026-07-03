import Image from "next/image";
import Link from "next/link";

const planLinks = [
  { href: "/ferry", label: "Ferry schedules" },
  { href: "/parking", label: "Parking & ATMs" },
  { href: "/webcams", label: "Webcams" },
  { href: "/itineraries", label: "Itineraries" },
];

const communityLinks = [
  { href: "/events", label: "Events calendar" },
  { href: "/give", label: "Volunteer & give back" },
  { href: "/hunt", label: "Scavenger hunt" },
  { href: "/about", label: "About this site" },
];

export function SiteFooter({ hiddenPaths = [] }: { hiddenPaths?: string[] }) {
  // Admin-hidden pages drop out of the footer lists too.
  const plan = planLinks.filter((l) => !hiddenPaths.includes(l.href));
  const community = communityLinks.filter((l) => !hiddenPaths.includes(l.href));
  return (
    <footer className="mt-12 bg-sound-deep text-white">
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
          <p className="font-display mt-3 text-lg font-semibold">Explore Kingston</p>
          <p className="mt-2 text-sm text-seaglass">
            The interactive companion to{" "}
            <a
              href="https://explorekingstonwa.com"
              className="font-medium text-white underline decoration-seaglass underline-offset-2 hover:text-seaglass"
            >
              explorekingstonwa.com
            </a>{" "}
            — your community guide to Kingston, Washington, ferry gateway to
            the Kitsap Peninsula and the Olympic Peninsula beyond.
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
            <li><Link href="/portal" className="font-medium hover:underline">Chamber &amp; business portal →</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-5xl px-4 py-4 text-xs text-seaglass/80">
          Built with the Greater Kingston Chamber of Commerce, publisher of{" "}
          <a href="https://explorekingstonwa.com" className="underline hover:text-white">
            explorekingstonwa.com
          </a>
          . Ferry data courtesy of WSDOT. Always confirm sailings with
          Washington State Ferries before traveling.
        </p>
      </div>
    </footer>
  );
}
