import type { SVGProps } from "react";

// Hand-rolled, because the portal needs six glyphs and an icon library is
// 50-200 KB plus its own sizing and stroke conventions to override. These
// inherit currentColor and obey the design tokens like everything else.
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

export const PORTAL_ICONS = {
  overview: IconOverview,
  business: IconBusiness,
  nonprofit: IconNonprofit,
  syndicate: IconSyndicate,
  account: IconAccount,
  admin: IconAdmin,
} as const;

export type PortalIconName = keyof typeof PORTAL_ICONS;
