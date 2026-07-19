"use client";

// Makes admin-editable copy reach CLIENT components too.
//
// Server components read overrides directly with copyText() from site-store.
// Client components can't (the store is server-only + async), so RootLayout
// loads the overrides once and provides them here; client components then use
// <EditableText/> or the useCopy() hook. Same keys, same registry, same
// /admin/content editor — the only difference is the delivery mechanism.
// Default wording comes from the registry via copyFallback (E07: call sites
// pass keys only; the registry is pure data and safe in client bundles).

import { createContext, useContext, type ReactNode } from "react";
import { copyFallback, type CopyKey } from "@/lib/site-copy-registry";
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

/** Resolve a copy key: admin override if non-empty, else the registry fallback. */
export function useCopy(key: CopyKey): string {
  const overrides = useContext(CopyContext);
  const t = overrides[key];
  return t && t.trim().length > 0 ? t : copyFallback(key);
}

/**
 * Editable text for client components. Renders the admin override (or the
 * registry fallback) as `as` (default span). rich=true parses **bold** and
 * [links](…).
 */
export function EditableText({
  copyKey,
  rich = false,
  as: Tag = "span",
  className,
}: {
  copyKey: CopyKey;
  rich?: boolean;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}) {
  const text = useCopy(copyKey);
  return <Tag className={className}>{rich ? <RichText text={text} /> : text}</Tag>;
}
