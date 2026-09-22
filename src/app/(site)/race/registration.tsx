"use client";

// The 5K registration form, embedded from Zeffy (ADR-0008 amendment 1).
//
// Click-to-load on purpose. Zeffy's page runs its own analytics, session
// recording and ad cookies, and the privacy page promises "no third-party
// analytics or ad tech". Until a visitor presses Register nothing from Zeffy
// loads, which is the same position as the plain link this replaces.
//
// No sandbox attribute: Zeffy's checkout runs Stripe, 3-D Secure and wallet
// sheets inside the frame, and a sandbox that broke one of them would only
// show up on a real purchase. Browsers already stop a cross-origin frame from
// navigating this page without a click.

import { useEffect, useRef, useState } from "react";

import { OutboundLink } from "@/components/tracker";

const ZEFFY_ORIGIN = "https://www.zeffy.com";

/** Only an https URL whose origin is exactly www.zeffy.com may be framed.
 *  The CSP (frame-src) enforces the same thing; this keeps a mistyped URL in
 *  race.ts from rendering an empty box. */
export function isZeffyEmbed(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === ZEFFY_ORIGIN;
  } catch {
    return false;
  }
}

const buttonClass =
  "inline-flex items-center justify-center rounded-full bg-sound px-6 py-3 text-base font-semibold text-white hover:bg-sound-deep";

export function RaceRegistration({ embedUrl, linkUrl }: { embedUrl?: string; linkUrl?: string }) {
  const [open, setOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canEmbed = isZeffyEmbed(embedUrl);

  // The button disappears when pressed, so hand keyboard and screen-reader
  // focus to the form that replaced it rather than dropping it on the page.
  useEffect(() => {
    if (open) frameRef.current?.focus();
  }, [open]);

  if (!canEmbed && !linkUrl) {
    return <p className="font-semibold text-sound-deep">Registration opens soon.</p>;
  }

  if (!canEmbed) {
    return (
      <OutboundLink href={linkUrl!} className={buttonClass}>
        Register on zeffy.com
      </OutboundLink>
    );
  }

  return (
    <div>
      {open ? (
        <iframe
          ref={frameRef}
          src={embedUrl}
          title="Register for the 5K on Zeffy"
          allow="payment"
          className="h-[1100px] w-full rounded-xl border border-sand bg-white"
        />
      ) : (
        <>
          <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
            Register now
          </button>
          <p className="mt-2 text-sm text-ink">
            The form opens here, run by Zeffy. Zeffy sets its own cookies and analytics. This site
            sets none.
          </p>
        </>
      )}
      {linkUrl && (
        <p className="mt-3 text-sm">
          <OutboundLink href={linkUrl} className="font-medium text-tide-deep underline">
            Or open the form on zeffy.com
          </OutboundLink>
        </p>
      )}
    </div>
  );
}
