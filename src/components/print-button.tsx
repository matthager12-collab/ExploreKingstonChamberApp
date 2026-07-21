"use client";

// E14 — the one interactive control on /print. Kept in its own client component
// so the page itself stays a server component (it renders ferry times that must
// come from the server snapshot, not a fetch in the browser).
//
// print:hidden because the button must not appear on the paper it produces.

import { useCopy } from "@/lib/copy-context";

export function PrintButton({ className = "" }: { className?: string }) {
  const label = useCopy("print.button.label");
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`inline-flex min-h-11 items-center rounded-full bg-sound-deep px-5 py-3 text-base font-semibold text-white print:hidden ${className}`}
    >
      {label}
    </button>
  );
}
