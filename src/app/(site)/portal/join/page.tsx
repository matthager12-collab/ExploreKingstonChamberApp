import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";
import { JoinForm } from "../forms";

export const metadata: Metadata = { title: "Join the portal" };

export default function JoinPage() {
  return (
    <>
      <PageHeader
        eyebrow="For local businesses & nonprofits"
        title="Create your account"
        intro="You'll need an invite code from the Greater Kingston Chamber of Commerce — it links your account to your listing so only you (and the Chamber) can edit it."
      />
      <Section>
        <JoinForm />
      </Section>
    </>
  );
}
