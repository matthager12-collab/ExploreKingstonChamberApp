import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, hasAnyUsers } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { adminNavFor } from "@/lib/admin-nav";
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
  // Admin surfaces come from the ONE nav manifest (src/lib/admin-nav.ts) that the
  // admin shell also renders — so the portal dashboard and the in-shell nav can
  // never drift, and adding a surface is a one-line change there, not here.
  if (user.role === "admin") {
    for (const entry of adminNavFor(user)) {
      cards.push({ href: entry.href, title: entry.title, blurb: entry.blurb });
    }
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
            Your account and permissions are active. Manage your account details
            here anytime.
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
