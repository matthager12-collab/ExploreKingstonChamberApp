"use client";

// Makes admin-editable copy reach CLIENT components too.
//
// Server components read overrides directly with copyText() from site-store.
// Client components can't (the store is server-only + async), so RootLayout
// loads the overrides once and provides them here; client components then use
// <EditableText/> or the useCopy() hook. Same keys, same registry, same
// /admin/content editor — the only difference is the delivery mechanism.

import { createContext, useContext, type ReactNode } from "react";
import { RichText } from "@/components/rich-text";

const CopyContext = createContext<Record<string, string>>({});

export function CopyProvider({
  overrides,
  children,
}: {
  overrides: Record<string, string>;
  children: ReactNode;
}) {
  return <CopyContext.Provider value={overrides}>{children}</CopyContext.Provider>;
}

/** Resolve a copy key: admin override if non-empty, else the fallback. */
export function useCopy(key: string, fallback: string): string {
  const overrides = useContext(CopyContext);
  const t = overrides[key];
  return t && t.trim().length > 0 ? t : fallback;
}

/**
 * Editable text for client components. Renders the admin override (or the
 * fallback) as `as` (default span). rich=true parses **bold** and [links](…).
 */
export function EditableText({
  copyKey,
  fallback,
  rich = false,
  as: Tag = "span",
  className,
}: {
  copyKey: string;
  fallback: string;
  rich?: boolean;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}) {
  const text = useCopy(copyKey, fallback);
  return <Tag className={className}>{rich ? <RichText text={text} /> : text}</Tag>;
}
