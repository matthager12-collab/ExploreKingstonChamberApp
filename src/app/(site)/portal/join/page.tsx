import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";
import { JoinForm } from "@/components/portal/auth-forms";

export const metadata: Metadata = { title: "Join the portal" };

// E17 sub-minute claim: /portal/join?code=XYZ pre-fills the invite code, so
// the link the Chamber sends is one tap → name/email/password → done.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code.trim() : "";
  return (
    <>
      <PageHeader
        eyebrow="For local businesses & nonprofits"
        title="Create your account"
        intro="You'll need an invite code from the Greater Kingston Chamber of Commerce — it links your account to your listing so only you (and the Chamber) can edit it."
      />
      <Section>
        <JoinForm initialCode={code || undefined} />
      </Section>
    </>
  );
}
