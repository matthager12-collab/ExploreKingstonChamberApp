import type { ReactElement, SVGProps } from "react";
import type { NavIconName } from "@/lib/nav-icons";

// Hand-rolled, because the two rails need thirteen glyphs between them and an
// icon library is 50-200 KB plus its own sizing and stroke conventions to
// override. These inherit currentColor and obey the design tokens like
// everything else.
//
// Every one is aria-hidden: in the rail they sit beside a visible label, and
// when the rail is collapsed the link itself carries an aria-label. An icon is
// never the only name for a control here.

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 22, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* The two EXIT glyphs. A console is a room, and a room needs a door — these
 * mark the way back to the public site and across to the other console. Both
 * are deliberately literal (a house, an arrow leaving a panel) rather than
 * clever: an icon is a memory test, and the one control someone reaches for
 * when they feel stuck is the worst place to set a puzzle. */
export function IconSite(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
      <path d="M9.75 21v-6.5h4.5V21" />
    </Glyph>
  );
}

export function IconLeave(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M14 3h4.5a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </Glyph>
  );
}

export function IconOverview(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Glyph>
  );
}

export function IconBusiness(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 9.5 5 4h14l2 5.5" />
      <path d="M4 9.5h16V20H4z" />
      <path d="M9.5 20v-5h5v5" />
    </Glyph>
  );
}

export function IconNonprofit(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z" />
    </Glyph>
  );
}

export function IconSyndicate(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="18" r="2" />
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 5a15 15 0 0 1 15 15" />
    </Glyph>
  );
}

export function IconAccount(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Glyph>
  );
}

export function IconAdmin(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5 4.5 6.5v5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5v-5Z" />
      <path d="m9 12 2 2 4-4" />
    </Glyph>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m9 6 6 6-6 6" />
    </Glyph>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Glyph>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}


export function IconInsights(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20V10M10 20V5M16 20v-7M22 20H2" />
    </Glyph>
  );
}

// A checklist rather than a clipboard: the worklist is a QUEUE you draw down,
// and two ticked rows say that where a clipboard outline would only say
// "document". Same reasoning as the exit glyphs — literal beats clever on the
// control someone reaches for when work is piling up.
export function IconWorklist(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m3 7.5 1.8 1.8 3.4-3.4" />
      <path d="m3 16.5 1.8 1.8 3.4-3.4" />
      <path d="M12.5 8h8.5M12.5 17h8.5" />
    </Glyph>
  );
}

export function IconEvents(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Glyph>
  );
}

export function IconExperiences(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </Glyph>
  );
}

export function IconMaps(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V4l5-2Z" />
      <path d="M9 2v16M15 6v16" />
    </Glyph>
  );
}

export function IconSystem(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Glyph>
  );
}

// The union lives in src/lib/nav-icons.ts (see the boundary note there); this
// record must COVER it, so adding a nav slot without drawing its glyph is a
// type error rather than a blank square in the rail.
export const NAV_ICONS: Record<NavIconName, (props: IconProps) => ReactElement> = {
  // portal
  overview: IconOverview,
  business: IconBusiness,
  nonprofit: IconNonprofit,
  syndicate: IconSyndicate,
  account: IconAccount,
  admin: IconAdmin,
  // admin sections
  insights: IconInsights,
  worklist: IconWorklist,
  members: IconAccount,
  listings: IconBusiness,
  events: IconEvents,
  experiences: IconExperiences,
  maps: IconMaps,
  system: IconSystem,
  // exits
  site: IconSite,
  leave: IconLeave,
};

export type { NavIconName };
