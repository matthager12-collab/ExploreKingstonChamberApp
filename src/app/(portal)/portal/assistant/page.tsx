import { redirect } from "next/navigation";
import { getSessionUser, can } from "@/lib/auth";
import { PortalPage } from "@/components/portal/page";
import { researchContext } from "@/lib/research/context";
import { Assistant } from "./assistant";
export const dynamic = "force-dynamic";
export const metadata = { title: "Research & drafts" };
export default async function AssistantPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "manage-site")) redirect("/portal");
  const context = await researchContext();
  return (
    <PortalPage
      width="wide"
      title="Maps & site updates"
      intro="Share a link or an idea. Research comes back as sourced drafts for you to review."
    >
      <Assistant
        views={context.views.map((v) => ({ id: v.id, name: v.name }))}
        categories={context.categories.map((c) => ({
          key: c.key,
          label: c.label,
        }))}
      />
    </PortalPage>
  );
}
