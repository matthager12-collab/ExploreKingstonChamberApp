"use client";

// Expanding "see the ferry line right now" box for the Ferry page. Collapsed by
// default; opening it lazily mounts the shared WebcamGrid (so the WSDOT images
// only start polling once the visitor actually asks to see them). Shows the
// cameras for the side the visitor is on, with a link to the full Webcams page.

import { useState } from "react";
import Link from "next/link";
import type { Webcam } from "@/lib/types";
import { WebcamGrid } from "@/app/(site)/webcams/webcam-grid";

export function FerryWebcamsBox({
  cams,
  sideLabel,
  totalCount,
  webcamsPageVisible,
}: {
  cams: Webcam[];
  /** e.g. "the Kingston approach" / "the Edmonds approach". */
  sideLabel: string;
  /** Total cams across both sides, for the "all webcams" link. */
  totalCount: number;
  /** Whether the standalone /webcams page is visible (else don't link to it). */
  webcamsPageVisible: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (cams.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-sand bg-white shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-seaglass/20"
      >
        <div>
          <p className="font-semibold text-sound-deep">📷 See the ferry line right now</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            Live WSDOT cameras along {sideLabel} — check how long the line is before you commit.
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-tide-deep">
          {open ? "Hide ▲" : "Show ▾"}
        </span>
      </button>

      {open && (
        <div className="border-t border-sand p-5">
          <WebcamGrid cams={cams} />
          <p className="mt-4 text-sm text-ink-soft">
            Still images from WSDOT, refreshed about once a minute.
            {webcamsPageVisible && (
              <>
                {" "}
                <Link
                  href="/webcams"
                  className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2"
                >
                  All {totalCount} cameras, both sides →
                </Link>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
