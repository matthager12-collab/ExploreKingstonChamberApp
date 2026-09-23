"use client";

// The 5K registration form, embedded from Zeffy (ADR-0008 amendment 1).
//
// Click-to-load on purpose. Zeffy's page runs its own analytics, session
// recording and ad cookies, and the privacy page promises "no third-party
// analytics or ad tech". Until a visitor presses Register nothing from Zeffy
// loads, which is the same position as the plain link this replaces. The
// notice saying so stays on screen after the form opens.
//
// The embed address is derived from the campaign link rather than configured
// on its own, so the frame and the zeffy.com link cannot drift onto two
// different campaigns.
//
// No sandbox attribute: Zeffy's checkout runs Stripe, 3-D Secure and wallet
// sheets inside the frame, and a sandbox that broke one of them would only
// show up on a real purchase. Browsers already stop a cross-origin frame from
// navigating this page unless the visitor clicks inside it first.

import { useRef, useState } from "react";

import { OutboundLink } from "@/components/tracker";

const ZEFFY_ORIGIN = "https://www.zeffy.com";

/** The embeddable form for a Zeffy ticketing link, or undefined if the link
 *  is not an https ticketing page on www.zeffy.com. Protocol is checked as
 *  well as origin: a blob: URL reports its creator's origin. The CSP
 *  (frame-src) enforces the origin too; this keeps a wrong link in race.ts
 *  from rendering an empty box. */
export function zeffyEmbedFor(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || u.origin !== ZEFFY_ORIGIN) return undefined;
  if (u.pathname.includes("/embed/ticketing/")) return u.href;
  if (!u.pathname.includes("/ticketing/")) return undefined;
  u.pathname = u.pathname.replace("/ticketing/", "/embed/ticketing/");
  return u.href;
}

const buttonClass =
  "inline-flex items-center justify-center rounded-full bg-sound px-6 py-3 text-base font-semibold text-white hover:bg-sound-deep";

export function RaceRegistration({ linkUrl }: { linkUrl?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const embedUrl = zeffyEmbedFor(linkUrl);

  if (!linkUrl) {
    return <p className="font-semibold text-sound-deep">Registration opens soon.</p>;
  }

  if (!embedUrl) {
    return (
      <OutboundLink href={linkUrl} className={buttonClass}>
        Register online
      </OutboundLink>
    );
  }

  return (
    <div>
      {!open && (
        <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
          Register now
        </button>
      )}
      <p className="mt-2 text-sm text-ink">
        The form is Zeffy&apos;s and opens on this page. Zeffy runs its own cookies, analytics and
        session recording. This site runs none.
      </p>
      <p className="mt-1 text-sm">
        <OutboundLink href={linkUrl} className="font-medium text-tide-deep underline">
          Or open the form on zeffy.com
        </OutboundLink>
      </p>
      {open && (
        <>
          {!loaded && (
            <p role="status" className="mt-4 text-sm text-ink">
              Loading the registration form…
            </p>
          )}
          <iframe
            ref={frameRef}
            src={embedUrl}
            title="Register for the 5K on Zeffy"
            allow="payment"
            // Focus moves in once, when the form has actually arrived, so a
            // keyboard or screen-reader user is not dropped on a blank box.
            onLoad={() => {
              if (!loaded) frameRef.current?.focus();
              setLoaded(true);
            }}
            // Fits the screen: Zeffy's form fills whatever height it is
            // given and scrolls inside, so a frame taller than a phone would
            // leave two scroll areas fighting.
            className="mt-4 h-[85svh] min-h-[560px] w-full rounded-xl border border-sand bg-white"
          />
        </>
      )}
    </div>
  );
}
