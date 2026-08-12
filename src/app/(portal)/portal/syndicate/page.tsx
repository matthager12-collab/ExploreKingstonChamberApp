// Portal → the rest of the internet.
//
// Everything on this page reads the same canonical stores the public site
// uses, then packages that data for outbound use:
//   a. live feed URLs (JSON / iCal / embed) a member can wire into their own
//      website and calendars,
//   b. an honest copy-paste checklist for Google/Apple/Yelp/Bing — there is
//      no API sync yet, and we say so plainly,
//   c. prewritten social posts for each upcoming event they manage.
//
// Server component; the only interactivity is the Copy buttons, handled by
// one small inline delegated-click script (no client component needed).

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { getEvents } from "@/lib/stores/event-store";
import { Badge, Callout, Card, PageHeader, Section } from "@/components/ui";
import type { EventItem } from "@/lib/types";

export const metadata: Metadata = { title: "Push it everywhere" };
export const dynamic = "force-dynamic";

// ---------- formatting (always Kingston time) ----------

const TZ = "America/Los_Angeles";

function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .toLowerCase();
}

function whenLabel(e: EventItem): string {
  let label = `${fmtDay(e.start)}, ${fmtTime(e.start)}`;
  if (e.end && fmtDay(e.end) === fmtDay(e.start)) label += `–${fmtTime(e.end)}`;
  return label;
}

function composePost(e: EventItem, base: string): string {
  const link = e.url ?? `${base}/events`;
  return `${e.title}\n${whenLabel(e)} at ${e.venue}\nDetails: ${link}`;
}

/**
 * Events that haven't finished yet (in-progress still counts). Lives outside
 * the page component: this is a dynamic server page, so reading the clock per
 * request is intended — kept here so the render body itself stays pure.
 */
function upcomingEvents(events: EventItem[]): EventItem[] {
  const now = Date.now();
  return events.filter((e) => new Date(e.end ?? e.start).getTime() >= now);
}

// ---------- UI pieces ----------

const copyButtonClass =
  "shrink-0 rounded-full bg-sound px-3 py-1 text-xs font-semibold text-white hover:bg-sound-deep";
const outLinkClass =
  "font-semibold text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound";

/** A labeled snippet with a Copy button; the inline script below handles clicks. */
function CopyBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-sound-deep">{label}</p>
        <button type="button" data-copy={value} className={copyButtonClass}>
          Copy
        </button>
      </div>
      {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}
      <pre className="mt-1.5 overflow-x-auto rounded-lg border border-sand bg-sand/40 p-3 font-mono text-xs whitespace-pre-wrap break-all text-ink">
        {value}
      </pre>
    </div>
  );
}

const PLATFORMS: { name: string; href: string; tip: string }[] = [
  {
    name: "Google Business Profile",
    href: "https://business.google.com/",
    tip: "Sign in, pick your location, then Edit profile → Hours. This is the listing most visitors see first.",
  },
  {
    name: "Apple Business Connect",
    href: "https://businessconnect.apple.com/",
    tip: "Feeds Apple Maps and Siri. Claim your place card once; hour edits usually go live within a day.",
  },
  {
    name: "Yelp for Business",
    href: "https://biz.yelp.com/",
    tip: "Business Information → Hours. Yelp data also flows into some in-car navigation systems.",
  },
  {
    name: "Bing Places",
    href: "https://www.bingplaces.com/",
    tip: "Covers Bing and Windows Maps. You can import your Google Business Profile instead of retyping everything.",
  },
];

// Delegated click handler for every [data-copy] button on the page, with a
// textarea fallback for browsers that gate navigator.clipboard.
const COPY_SCRIPT = `
document.addEventListener("click", function (event) {
  var btn = event.target && event.target.closest ? event.target.closest("[data-copy]") : null;
  if (!btn) return;
  var text = btn.getAttribute("data-copy") || "";
  var done = function () {
    var prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(function () { btn.textContent = prev; }, 1500);
  };
  var fallback = function () {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (err) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else {
    fallback();
  }
});
`;

interface Listing {
  id: string;
  name: string;
  kind: "business" | "nonprofit";
  hours?: string;
  hoursVerified?: string;
}

// ---------- page ----------

export default async function SyndicatePage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");

  const [restaurants, charities, events, headerList] = await Promise.all([
    getRestaurants(),
    getCharities(),
    getEvents(),
    headers(),
  ]);

  // Absolute URLs for copy-paste snippets, from the request itself.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;

  const isAdmin = user.role === "admin";
  const listings: Listing[] = [
    ...restaurants
      .filter((r) => isAdmin || user.editableIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: "business" as const,
        hours: r.hours,
        hoursVerified: r.hoursVerified,
      })),
    ...charities
      .filter((c) => isAdmin || user.editableIds.includes(c.id))
      .map((c) => ({ id: c.id, name: c.name, kind: "nonprofit" as const })),
  ];

  const listingIds = new Set(listings.map((l) => l.id));
  const myUpcoming = upcomingEvents(events).filter(
    (e) =>
      isAdmin ||
      (e.ownerId !== undefined && listingIds.has(e.ownerId)) ||
      (e.charityId !== undefined && listingIds.has(e.charityId)),
  );

  return (
    <>
      <PageHeader
        eyebrow={isAdmin ? "Chamber admin — all listings" : "Syndication"}
        title="Push it everywhere"
        intro="Your listing and events live here once. These tools carry them out to your own website, calendar apps, and the big platforms — no retyping."
      />

      {listings.length === 0 && !isAdmin && (
        <Section>
          <Callout title="No listing linked yet" tone="coral">
            Your account is not linked to a business or organization listing, so there are no
            feeds to show. Contact the Chamber and we will connect your account.
          </Callout>
        </Section>
      )}

      {/* a. live feeds ---------------------------------------------------- */}
      <Section
        title="Your live feeds"
        subtitle="These URLs always serve your latest portal data — update once here and everything reading them follows."
      >
        <div className="space-y-4">
          {isAdmin && (
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-lg font-semibold text-sound-deep">
                  All Kingston events
                </p>
                <Badge tone="navy">town-wide</Badge>
              </div>
              <div className="mt-4 space-y-4">
                <CopyBlock
                  label="Events JSON feed"
                  hint="Every upcoming event, machine-readable."
                  value={`${base}/api/feeds/events`}
                />
                <CopyBlock
                  label="Calendar subscription (iCal)"
                  hint="Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription."
                  value={`${base}/api/feeds/events?format=ics`}
                />
                <CopyBlock
                  label="Website embed"
                  hint="Paste into any site's HTML — renders the full town calendar."
                  value={`<script src="${base}/embed/kingston-events.js"></script>`}
                />
              </div>
            </Card>
          )}

          {listings.map((l) => (
            <Card key={l.id}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-lg font-semibold text-sound-deep">{l.name}</p>
                <Badge tone={l.kind === "business" ? "teal" : "coral"}>{l.kind}</Badge>
              </div>
              <div className="mt-4 space-y-4">
                <CopyBlock
                  label="Events JSON feed"
                  hint="Machine-readable list of your upcoming events — your web developer can render it anywhere."
                  value={`${base}/api/feeds/events?owner=${l.id}`}
                />
                <CopyBlock
                  label="Calendar subscription (iCal)"
                  hint="Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription. Subscribers get updates automatically."
                  value={`${base}/api/feeds/events?owner=${l.id}&format=ics`}
                />
                <CopyBlock
                  label="Website embed"
                  hint="Paste into your site's HTML where your events should appear. It styles itself and updates whenever you edit events in the portal."
                  value={`<script src="${base}/embed/kingston-events.js" data-owner="${l.id}"></script>`}
                />
                {l.kind === "business" && (
                  <CopyBlock
                    label="Listing JSON (hours + open-now)"
                    hint="Your website can poll this for your address, phone, hours, and a live open/closed flag — so your site never shows stale hours."
                    value={`${base}/api/feeds/business/${l.id}`}
                  />
                )}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* b. big platforms ------------------------------------------------- */}
      {listings.length > 0 && (
        <Section
          title="Update the big platforms"
          subtitle="Where visitors actually look you up — keep these matching the portal."
        >
          <div className="space-y-4">
            <Callout title="Update these by hand" tone="teal">
              Copy your current hours below, then open each platform and paste — the
              fastest way to keep every listing matching the portal.
            </Callout>

            {listings.map((l) => (
              <Card key={l.id}>
                <p className="font-display text-lg font-semibold text-sound-deep">{l.name}</p>
                {l.hours && (
                  <div className="mt-3">
                    <CopyBlock
                      label="Your current hours — ready to paste"
                      hint={
                        l.hoursVerified
                          ? `As entered in the portal; last verified ${l.hoursVerified}.`
                          : "As entered in the portal."
                      }
                      value={l.hours}
                    />
                  </div>
                )}
                <ul className="mt-4 space-y-2.5">
                  {PLATFORMS.map((p) => (
                    <li key={p.name} className="text-sm">
                      <a href={p.href} target="_blank" rel="noopener noreferrer" className={outLinkClass}>
                        {p.name}
                      </a>{" "}
                      <span className="text-ink-soft">— {p.tip}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* c. socials ------------------------------------------------------- */}
      <Section
        title="Post it to socials"
        subtitle="A ready-made post for each of your upcoming events."
      >
        {myUpcoming.length === 0 ? (
          <Callout title="No upcoming events yet" tone="teal">
            Add an event from your portal dashboard and it will show up here with
            ready-to-post text and share links.
          </Callout>
        ) : (
          <div className="space-y-4">
            {myUpcoming.map((e) => {
              const post = composePost(e, base);
              const link = e.url ?? `${base}/events`;
              const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
              const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(post)}`;
              return (
                <Card key={e.id}>
                  <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                    {whenLabel(e)}
                  </p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-sound-deep">
                    {e.title}
                  </p>
                  <div className="mt-3">
                    <CopyBlock label="Ready-to-post text" value={post} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <a
                      href={facebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={outLinkClass}
                    >
                      Share on Facebook
                    </a>
                    <a
                      href={twitterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={outLinkClass}
                    >
                      Post on X / Twitter
                    </a>
                  </div>
                  <p className="mt-2 text-xs text-ink-soft">
                    Instagram and TikTok do not accept web share links — copy the text above
                    and paste it into the app instead.
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* Copy-button behavior for every [data-copy] on this page. */}
      <script dangerouslySetInnerHTML={{ __html: COPY_SCRIPT }} />
    </>
  );
}
