import type { Metadata } from "next";

import { getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { getCopyOverrides } from "@/lib/stores/site-store";
import { AccessibilityStatement } from "./statement";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "Explore Kingston's accessibility statement: our WCAG 2.1 AA target, how we check it, known limitations, and how to give feedback.",
};

// Thin data shell. Everything the visitor reads is in ./statement.tsx — see the
// comment there for why the statement is code-owned and how the ADA compliance
// date is sourced (a registry block) and kept current.
export default async function AccessibilityPage() {
  // hiddenPaths so the text-alternative list never links to a page an operator
  // has hidden — see the Alt helper in ./statement.tsx.
  const [copy, hiddenPaths] = await Promise.all([getCopyOverrides(), getEffectiveHiddenPaths()]);
  return <AccessibilityStatement copy={copy} hiddenPaths={hiddenPaths} />;
}
