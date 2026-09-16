// Business portal home: every listing this account manages, one card each —
// restaurants, lodging places, and directory listings side by side, badged
// by type (directory cards carry their publish state — imported drafts are
// the domain's normal condition and the owner deserves to know theirs isn't
// public yet). Admins see all restaurants + lodging; the directory pile is
// deliberately omitted for admins — /admin/listings is its console, and 150+
// imported drafts would bury the two curated sections here.
// Requires a session; bounces to /portal otherwise.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getRestaurants } from "@/lib/stores/business-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { getEvents } from "@/lib/stores/event-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import { describeRepeat, rruleToPreset } from "@/lib/events/recurrence";
import { SeriesChecks, type SeriesCheck } from "./series-checks";
import type { Lodging } from "@/lib/types";
import { OpenBadge } from "@/components/open-badge";
import { Badge, Callout, Card } from "@/components/ui";
import { PortalPage } from "@/components/portal/page";

export const metadata: Metadata = { title: "My Business" };
export const dynamic = "force-dynamic";

// Same vocabulary as /stay, so the badge in the portal matches the public page.
const LODGING_TYPE_LABEL: Record<Lodging["type"], string> = {
  hotel: "Hotel",
  "vacation-rental": "Vacation rentals",
  bnb: "B&B",
  camping: "Camping",
  marina: "Marina",
};

// Same labels the admin workbench uses for the category select.
const DIRECTORY_CATEGORY_LABEL: Record<string, string> = {
  eat: "Eat & Drink",
  stay: "Stay",
  shop: "Shop",
  services: "Services",
  activities: "Activities",
  community: "Community",
  other: "Directory",
};

export default async function BusinessPortalPage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");
  if (user.role !== "member-business" && user.role !== "admin") redirect("/portal");

  const [allRestaurants, allLodging, allDirectory] = await Promise.all([
    getRestaurants(),
    getLodging(),
    // The ADMIN read on purpose: a member's imported listing is a draft, and
    // the public getter would hide their own record from them. Scoped to
    // editableIds right below; admins get [] here (see the header comment).
    user.role === "admin" ? Promise.resolve([]) : getDirectoryListingsAdmin(),
  ]);
  const restaurants =
    user.role === "admin"
      ? allRestaurants
      : allRestaurants.filter((r) => user.editableIds.includes(r.id));
  const lodging =
    user.role === "admin"
      ? allLodging
      : allLodging.filter((l) => user.editableIds.includes(l.id));
  const directory = allDirectory.filter((d) => user.editableIds.includes(d.id));

  // E17 claim-signup slice: this account's claims still with the Chamber.
  // Filtered in code (payload.userId lives in jsonb) — the open claim_signup
  // queue is small by nature. Admins skip it: their queue is /admin/worklist.
  const pendingClaims =
    user.role === "admin"
      ? []
      : (
          await listWorklistItems({ type: "claim_signup", state: ["open", "in_progress"] })
        ).filter((item) => (item.payload as { userId?: unknown }).userId === user.id);

  // Quarterly series checks assigned to THIS account. Scoped by assignee, not
  // by listing: after an escalation the task belongs to the Chamber, and it
  // should leave this page the moment that happens.
  const assigned = await listWorklistItems({
    type: "staleness",
    subjectStore: "events",
    assigneeUserId: user.id,
    state: ["open", "in_progress"],
  });
  let seriesChecks: SeriesCheck[] = [];
  if (assigned.length > 0) {
    const events = await getEvents();
    const byId = new Map(events.map((e) => [e.id, e]));
    seriesChecks = assigned.flatMap((item) => {
      const event = byId.get(item.subjectId);
      // An event that has since been taken down leaves a task with nothing to
      // confirm; the Chamber's queue still shows it, so it is not lost.
      if (!event) return [];
      const preset = rruleToPreset(event.rrule);
      return [
        {
          itemId: item.id,
          eventId: event.id,
          title: event.title,
          repeat: preset ? describeRepeat(preset) : "Repeats",
          ...(event.ownerId ? { listingId: event.ownerId } : {}),
          dueAt: item.dueAt?.toISOString() ?? null,
        },
      ];
    });
  }

  // PortalPage, not the public PageHeader + Section: those centre themselves in
  // their own padded max-w-5xl column, which stacks with the shell's and leaves
  // the content narrower than its own heading.
  return (
    <PortalPage
      title="My business"
      intro="Update once, and it's everywhere — your hours, menus, and events flow straight to the public pages, the open-now badge, and the town calendar."
      width="wide"
    >
      {/* Merge note: the pending-claim callout landed on main while the portal
          was moving onto the shell. Both survive. The callout keeps its copy and
          its position ABOVE the listings — someone waiting on a claim needs to
          see that first — and only loses its <Section> wrapper, because
          PortalPage already owns the column and the gap. */}
      {pendingClaims.length > 0 && (
        <Callout title="Your claim is with the Chamber">
          {pendingClaims.length === 1
            ? `“${pendingClaims[0].subjectLabel}” is waiting for a quick review — once the Chamber approves it, the listing appears right here.`
            : `${pendingClaims.length} of your claims are waiting for a quick review — approved listings appear right here.`}
        </Callout>
      )}
      {seriesChecks.length > 0 && <SeriesChecks checks={seriesChecks} />}
      <div>
        {restaurants.length === 0 && lodging.length === 0 && directory.length === 0 ? (
          pendingClaims.length > 0 ? null : (
            <Callout title="No listings linked to this account yet" tone="coral">
              Your account isn&apos;t connected to a listing. Email the Chamber and
              they&apos;ll link your business in a minute.
            </Callout>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {restaurants.map((r) => (
              <Link key={r.id} href={`/portal/business/${r.id}`}>
                <Card className="h-full transition hover:border-tide">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-lg font-semibold text-sound-deep">
                      {r.name}
                    </p>
                    <OpenBadge weeklyHours={r.weeklyHours} />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {r.cuisine} · {"$".repeat(r.priceLevel)}
                  </p>
                  <p className="mt-2 text-sm text-ink">{r.hours ?? "No hours listed yet"}</p>
                  <div className="mt-3">
                    {r.hoursVerified ? (
                      <Badge tone="green">Hours verified {r.hoursVerified}</Badge>
                    ) : (
                      <Badge tone="coral">Hours not verified yet</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-medium text-tide-deep">
                    Edit listing, hours &amp; events →
                  </p>
                </Card>
              </Link>
            ))}
            {lodging.map((l) => (
              <Link key={l.id} href={`/portal/business/${l.id}`}>
                <Card className="h-full transition hover:border-tide">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-lg font-semibold text-sound-deep">
                      {l.name}
                    </p>
                    <Badge tone="navy">Lodging · {LODGING_TYPE_LABEL[l.type]}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-ink">{l.description}</p>
                  <p className="mt-3 text-sm font-medium text-tide-deep">
                    Edit listing →
                  </p>
                </Card>
              </Link>
            ))}
            {directory.map((d) => (
              <Link key={d.id} href={`/portal/business/${d.id}`}>
                <Card className="h-full transition hover:border-tide">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-lg font-semibold text-sound-deep">
                      {d.name}
                    </p>
                    <Badge tone="navy">
                      {DIRECTORY_CATEGORY_LABEL[d.category] ?? "Directory"}
                    </Badge>
                    {d.status === "live" ? (
                      <Badge tone="green">Published</Badge>
                    ) : (
                      <Badge tone="coral">Not public yet</Badge>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-ink">
                    {d.description || "No description yet — add one so visitors know who you are."}
                  </p>
                  <p className="mt-3 text-sm font-medium text-tide-deep">
                    Edit listing →
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PortalPage>
  );
}
