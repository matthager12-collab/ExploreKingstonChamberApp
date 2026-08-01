"use client";

// Expanding "see the ferry line right now" box, shared by /ferry and /line.
// Collapsed by default; opening it lazily mounts the shared WebcamGrid (so the
// WSDOT images only start polling once the visitor actually asks to see them).
// Shows the cameras for the relevant side, with a link to the full Webcams page.
//
// Staying collapsed-by-default is what makes this cheap enough for /line, whose
// perf floor assumes a phone on congested cellular: until someone taps, this is
// a button, not a grid of JPEGs on a refresh timer.

import { useState } from "react";
import Link from "next/link";
import type { Webcam } from "@/lib/types";
import { WebcamGrid } from "@/app/(site)/webcams/webcam-grid";

export function FerryWebcamsBox({
  cams,
  sideLabel,
  totalCount,
  webcamsPageVisible,
  title,
  blurb,
}: {
  cams: Webcam[];
  /** e.g. "the Kingston approach" / "the Edmonds approach". Used to build the
   *  default blurb; ignored when `blurb` is supplied. */
  sideLabel?: string;
  /** Total cams across both sides, for the "all webcams" link. */
  totalCount: number;
  /** Whether the standalone /webcams page is visible (else don't link to it). */
  webcamsPageVisible: boolean;
  /** Override the heading. /line reframes this: its readers are already in the
   *  line, so the default "before you commit" framing is wrong for them. */
  title?: string;
  /** Override the sub-line. See `title`. */
  blurb?: string;
}) {
  const [open, setOpen] = useState(false);
  if (cams.length === 0) return null;

  const heading = title ?? "📷 See the ferry line right now";
  const sub =
    blurb ?? `Live WSDOT cameras along ${sideLabel} — check how long the line is before you commit.`;

  return (
    <div className="overflow-hidden rounded-2xl border border-sand bg-white shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-seaglass/20"
      >
        <div>
          <p className="font-semibold text-sound-deep">{heading}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{sub}</p>
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
