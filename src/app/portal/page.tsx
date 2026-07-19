import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, hasAnyUsers } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { Callout, Card, PageHeader, Section } from "@/components/ui";
import { LoginForm, LogoutButton } from "./forms";

export const metadata: Metadata = { title: "Portal" };
export const dynamic = "force-dynamic";

export default async function PortalPage() {
  if (!(await hasAnyUsers())) redirect("/portal/setup");

  const user = await getSessionUser();
  if (!user) {
    return (
      <>
        <PageHeader
          eyebrow="For local businesses & nonprofits"
          title="Kingston Portal"
          intro="Update your hours once and every page of this site follows. Manage your events, volunteer shifts, and listing — free, from the Chamber."
        />
        <Section>
          <LoginForm />
        </Section>
      </>
    );
  }

  const cards: { href: string; title: string; blurb: string }[] = [];
  // Every role gets this one — it's the self-service account page.
  cards.push({
    href: "/portal/account",
    title: "My account",
    blurb: "Update your name, email, and password.",
  });
  if (user.role === "member-business" || user.role === "admin") {
    cards.push({
      href: "/portal/business",
      title: "My business",
      blurb: "Hours, listing details, menus & ordering links, and your events.",
    });
  }
  if (user.role === "org-editor" || user.role === "admin") {
    cards.push({
      href: "/portal/nonprofit",
      title: "My organization",
      blurb: "Volunteer shifts, your org profile, and event deconfliction.",
    });
  }
  cards.push({
    href: "/portal/syndicate",
    title: "Push it everywhere",
    blurb: "Feeds for your website plus checklists for Google, Apple, Yelp, and socials.",
  });
  // moderator and viewer are provisioned and ENFORCED in E06 (they sign in and
  // get correct 403s) but have no surfaces yet: the moderation queue is E08 and
  // the role-scoped admin shell is E10. Say so plainly rather than showing an
  // empty dashboard that looks broken.
  const awaitingTools = user.role === "moderator" || user.role === "viewer";
  if (user.role === "admin") {
    cards.push(
      {
        href: "/admin/accounts",
        title: "Accounts & invites",
        blurb: "Invite businesses and nonprofits, manage who edits what.",
      },
      {
        href: "/admin",
        title: "Visitor insights",
        blurb: "LTAC-ready analytics: origins, movement, top pages, outbound taps.",
      },
      {
        href: "/admin/hunts",
        title: "Scavenger hunts",
        blurb: "Build hunts, reference photos, review submissions.",
      },
      {
        href: "/admin/map",
        title: "Parking map editor",
        blurb: "Drag pins and lot shapes to match reality; mark them field-verified.",
      },
      {
        href: "/admin/maps",
        title: "Map builder",
        blurb: "Create map views and drop markers, trails, and areas onto them.",
      },
      {
        href: "/admin/content",
        title: "Site content",
        blurb: "Edit page text and show or hide entire pages.",
      },
      {
        href: "/admin/ferry-info",
        title: "Ferry settings",
        blurb: "Busyness prediction on/off + accuracy, boarding-pass status, and payment/cash facts.",
      },
      {
        href: "/admin/itineraries",
        title: "Itineraries",
        blurb: "Build and edit the ready-made day plans.",
      },
      {
        href: "/admin/listings",
        title: "Restaurants, lodging & webcams",
        blurb: "Edit Eat & Drink vendors — descriptions, show/hide, add new — plus lodging and webcams.",
      },
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={user.role === "admin" ? "Chamber admin" : "Welcome back"}
        title={`Hi, ${user.name.split(" ")[0]}`}
        intro="Everything you manage, in one place."
      />
      <Section>
        {awaitingTools && (
          <Callout title={`${ROLE_LABELS[user.role]} access is set up`}>
            Your account and permissions are active. The tools for this role arrive
            in a later phase — until then you can manage your own account details
            here.
          </Callout>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Link key={c.href} href={c.href}>
              <Card className="h-full transition hover:border-tide">
                <p className="font-display text-lg font-semibold text-sound-deep">{c.title}</p>
                <p className="mt-1 text-sm text-ink-soft">{c.blurb}</p>
              </Card>
            </Link>
          ))}
        </div>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </Section>
    </>
  );
}
