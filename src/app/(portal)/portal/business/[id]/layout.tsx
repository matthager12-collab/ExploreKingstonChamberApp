import Link from "next/link";
import { Tabs } from "@/components/portal/tabs";
import { PortalPage } from "@/components/portal/page";
import { introFor, requireBusinessRecord } from "./record";

// The record frame: name, what-happens-when-I-save, the way back, and the tabs.
//
// It lives in the layout so all three panes share one heading and the tabs
// survive switching between them — only the pane below swaps.
//
// TABS ONLY FOR RESTAURANTS. They are the only kind with hours and events; a
// lodging or directory listing has one form, and a tab bar with one tab is the
// same "navigation that offers no choice" the section panel was just cured of.

export default async function BusinessRecordLayout({
  children,
  params,
}: LayoutProps<"/portal/business/[id]">) {
  const { id } = await params;
  const { user, record } = await requireBusinessRecord(id);

  const tabbed = record.kind === "restaurant";

  return (
    <PortalPage
      title={record.name}
      intro={introFor(record, user)}
      width={tabbed ? "wide" : "form"}
      actions={
        <Link
          href="/portal/business"
          className="text-sm font-semibold text-secondary underline underline-offset-2 hover:text-secondary-deep"
        >
          ← All my listings
        </Link>
      }
    >
      {tabbed && (
        <Tabs
          label={`${record.name} sections`}
          items={[
            { href: `/portal/business/${id}`, label: "Listing" },
            { href: `/portal/business/${id}/hours`, label: "Hours" },
            { href: `/portal/business/${id}/events`, label: "Events" },
          ]}
        />
      )}
      {children}
    </PortalPage>
  );
}
