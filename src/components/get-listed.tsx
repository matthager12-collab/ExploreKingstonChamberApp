// "Get listed" calls-to-action: the door-is-open notice for Kingston
// businesses that are NOT on the site yet. GetListedCallout sits at the bottom
// of /eat and /stay; PortalInviteHint is the one-liner under the /portal
// sign-in form for businesses without an account. Server components only —
// plain mailto:/tel: links, no client JS.
//
// Wording is Chamber-editable via the getListed.* / portal.login.* copy keys.
// The email and phone render from the EXISTING contact.* keys, so the office
// maintains its contact details in exactly one place (the footer's phone
// number follows the same key).

import { copyText } from "@/lib/stores/site-store";
import { Callout } from "@/components/ui";

const linkClass =
  "font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound";

/** `tel:` href for a printed-style number ("360-860-2239" → "tel:+13608602239"). */
function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

/** Email + phone links from the contact.* keys, appended after a copy block. */
function ContactLinks({
  copy,
  subject,
}: {
  copy: Record<string, string>;
  subject: string;
}) {
  const email = copyText(copy, "contact.email.address");
  const phone = copyText(copy, "contact.phone.number");
  return (
    <>
      Email{" "}
      <a href={`mailto:${email}?subject=${subject}`} className={linkClass}>
        {email}
      </a>{" "}
      or call{" "}
      <a href={telHref(phone)} className={linkClass}>
        {phone}
      </a>
      .
    </>
  );
}

/** Bottom-of-page callout on /eat and /stay. */
export function GetListedCallout({ copy }: { copy: Record<string, string> }) {
  return (
    <Callout title={copyText(copy, "getListed.callout.title")} tone="coral">
      <p>
        {copyText(copy, "getListed.callout.body")}{" "}
        <ContactLinks copy={copy} subject="Get%20listed%20on%20Visit%20Kingston" />
      </p>
    </Callout>
  );
}

/** One line under the /portal login form for businesses without an account. */
export function PortalInviteHint({ copy }: { copy: Record<string, string> }) {
  return (
    <p className="mt-4 max-w-sm text-sm text-ink">
      {copyText(copy, "portal.login.noAccount")}{" "}
      <ContactLinks
        copy={copy}
        subject="Portal%20invite%20for%20my%20Kingston%20business"
      />
    </p>
  );
}
