import type { Metadata } from "next";
import Link from "next/link";
import { VisitorSurvey } from "@/components/visitor-survey";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { Callout, Card, ExternalLink, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "About",
  description:
    "Visit Kingston is a free, ad-free community project built with the Greater Kingston Chamber of Commerce — and an honest look at what we track and why.",
};

// Copy and visibility are admin-editable — refresh within a minute like the
// other public pages.
export const revalidate = 60;

export default async function AboutPage() {
  const hiddenPreview = await assertPageVisible("/about");
  const copy = await getCopyOverrides();
  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "about.header.eyebrow")}
        title={copyText(copy, "about.header.title")}
        intro={copyText(copy, "about.header.intro")}
      />

      <Section title="Why your visit counts">
        <div className="space-y-4 text-ink-soft">
          <p>
            Washington adds a small lodging tax to hotel and short-term-rental stays, and state
            law (chapter 67.28 RCW) sends that money back into tourism — festivals, trails,
            marketing, visitor facilities. Here&apos;s the fair catch: any group that receives
            those dollars must report real visitor numbers to the state legislature&apos;s
            auditors, JLARC — how many people came, how many traveled 50+ miles, how many stayed
            overnight in paid lodging.
          </p>
          <p>
            Kingston is unincorporated, so our share flows through Kitsap County&apos;s Lodging
            Tax Advisory Committee — which gives priority to unincorporated communities like
            ours. Good counts are how Kingston&apos;s small nonprofits win the grants that pay
            for the events and trails you came here to enjoy. That&apos;s the whole reason we
            ask this one quick, anonymous question:
          </p>
          <VisitorSurvey />
          <p className="text-sm">
            Want the fine print? Read{" "}
            <ExternalLink href="https://app.leg.wa.gov/rcw/default.aspx?cite=67.28.1816">
              RCW 67.28.1816
            </ExternalLink>{" "}
            (the reporting law) or visit the{" "}
            <ExternalLink href="https://www.kitsap.gov/das/Pages/LTAC.aspx">
              Kitsap County LTAC page
            </ExternalLink>
            .
          </p>
        </div>
      </Section>

      <Section title="What we track (and what we don't)">
        <Card>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-sound-deep">We keep</h3>
              <ul className="mt-2 space-y-2 text-sm text-ink-soft">
                <li>
                  Anonymous visit counts — which pages get viewed, the rough region a connection
                  comes from (never your precise location), and which local-business links get
                  tapped, like menus, ordering, maps, and bookings.
                </li>
                <li>
                  Anonymous survey answers, counted only in aggregate — distance band, day trip
                  or overnight, nights stayed. The survey is optional; never tied to a person or
                  device.
                </li>
                <li>
                  Device location, only when you tap a location feature (like &ldquo;what&apos;s
                  open near me&rdquo;) — always behind the browser&apos;s permission prompt,
                  rounded to about a block before it&apos;s stored, and reported only as
                  neighborhood-level counts.
                </li>
                <li>
                  When you post a photo at a scavenger-hunt stop, that photo and its location
                  go to the hunt organizers at the Chamber so they can confirm the find. It&apos;s
                  the one thing the app sends on your behalf — don&apos;t include anything you
                  wouldn&apos;t want them to see.
                </li>
                <li>That&apos;s it. Really.</li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-sound-deep">We never do</h3>
              <ul className="mt-2 space-y-2 text-sm text-ink-soft">
                <li>No accounts or sign-ins — nothing here needs one.</li>
                <li>No cookies for tracking, no ad tech, and nothing is ever sold to anyone.</li>
                <li>
                  No precise location logging for analytics — outside the opt-in location
                  features above, we only see the rough region a connection comes from, and even
                  opted-in pings are coarsened to about a block before anything is stored.
                </li>
                <li>
                  No hidden uploads — the app only sends something you made when you deliberately
                  post a scavenger-hunt photo (see left).
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-5">
            <Callout title="The short version">
              We count visits, not visitors — anonymous aggregates only, in support of the
              lodging-tax grant reporting described above. The state needs totals; nobody needs
              your data.
            </Callout>
          </div>
        </Card>
      </Section>

      <Section title="Data sources &amp; thanks">
        <p className="text-ink-soft">
          The live info on this site comes straight from the folks who run things. Thanks to:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft">
          <li>
            <ExternalLink href="https://wsdot.wa.gov/traffic/api/">WSDOT Ferries API</ExternalLink>{" "}
            — real-time sailings, terminal alerts, and vessel data for the Edmonds–Kingston run.
          </li>
          <li>
            <ExternalLink href="https://www.kitsaptransit.com">Kitsap Transit</ExternalLink> — bus
            connections and the Kingston fast ferry to Seattle.
          </li>
          <li>
            <ExternalLink href="https://www.weather.gov">National Weather Service</ExternalLink> —
            forecasts for the Kitsap Peninsula.
          </li>
          <li>
            <ExternalLink href="https://tidesandcurrents.noaa.gov">
              NOAA Tides &amp; Currents
            </ExternalLink>{" "}
            — tide predictions for Appletree Cove.
          </li>
          <li>
            <ExternalLink href="https://www.portofkingston.org">Port of Kingston</ExternalLink> —
            marina, guest moorage, and waterfront info.
          </li>
        </ul>
      </Section>

      <Section title="For local businesses &amp; nonprofits">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Get listed</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Run a Kingston business or want your event on the calendar? Email the Chamber at{" "}
              <a
                href="mailto:info@kingstonchamber.com"
                className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
              >
                info@kingstonchamber.com
              </a>{" "}
              — listings are free.
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Restaurants</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Menu or hours changed? Send the Chamber your new link and we&apos;ll update your
              listing — visitors trust the site because it&apos;s current.
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Nonprofits</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Planning a fundraiser? Check the{" "}
              <Link
                href="/give"
                className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
              >
                shared community calendar
              </Link>{" "}
              first so events don&apos;t collide, and post your volunteer needs there too.
            </p>
          </Card>
        </div>
        <div className="mt-5">
          <Callout title="Lodging-tax grants" tone="coral">
            Kitsap County&apos;s next lodging-tax grant round (for 2027 funds) is expected to run
            October 1–30, 2026, and the county prioritizes unincorporated communities like
            Kingston. Dates shift year to year — confirm on the{" "}
            <ExternalLink href="https://www.kitsap.gov/das/Pages/LTAC.aspx">
              Kitsap County LTAC page
            </ExternalLink>
            .
          </Callout>
        </div>
      </Section>
    </>
  );
}
