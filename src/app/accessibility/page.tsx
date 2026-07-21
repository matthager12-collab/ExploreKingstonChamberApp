import type { Metadata } from "next";

import { getCopyOverrides } from "@/lib/stores/site-store";
import { AccessibilityStatement } from "./statement";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "Explore Kingston's accessibility statement: our WCAG 2.1 AA target, how we check it, known limitations, and how to give feedback.",
};

// Thin data shell. Everything the visitor reads is in ./statement.tsx — see the
// comment there for why the statement is code-owned and why the ADA compliance
// date is deliberately not stated.
export default async function AccessibilityPage() {
  return <AccessibilityStatement copy={await getCopyOverrides()} />;
}
