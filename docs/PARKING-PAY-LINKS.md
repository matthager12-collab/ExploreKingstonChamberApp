# Parking "Pay now" out-links (Option A)

**Status:** proposed / not yet built · **Cost:** $0 · **Effort:** ~0.5–1 day · **Owner:** Mat

The free, no-backend way to make paying for Kingston parking one tap from the app. This is
"Option A" from the July 2026 PassportParking research (workflow `wf_76e8dc6f-f25`). It ships
value now; the paid **Option B** (a Port-sponsored T2 Systems integration) is a separate,
next-budget-year track — see `docs/chamber/` and the LTAC brief.

---

## 1. Why this shape (the vendor reality)

**We do not integrate PassportParking.** Passport is not a vendor in Kingston. Each paid lot
already runs on a payment system with a public consumer flow; the app just needs to *hand the
user off to the right one*, pre-loaded with the zone code the app already knows.

| Lot (`MapZone` id) | Vendor | Hand-off the app builds |
|---|---|---|
| `port-pokpark-north-rows`, `port-pokpark-main-fan`, `port-pokpark-89-103` | T2 MobilePay (text-to-pay) | `sms:` → text **POKPARK** to **25023** |
| `port-pokhill` | T2 MobilePay | `sms:` → text **POKHILL** to **25023** |
| `port-poktt` | T2 MobilePay | `sms:` → text **POKTT** to **25023** |
| `diamond-d515` | ParkMobile + PayByPhone | ParkMobile web deep-link (zone **97599515**); PayByPhone out-link |
| free 2-hr / unrestricted streets, park & rides, permit/tenant/prohibited zones | — (free or N/A) | **no button** |

No money touches our app; no API key; no partnership. We're surfacing rails the operators
already run. **Durability caveat:** the `sms:` body pre-fill and the ParkMobile
`internalZoneCode` URL are undocumented/unofficial. Always render the code as visible
tap-to-copy text so the feature degrades to "here's the code, text it yourself" rather than
breaking. Re-verify quarterly alongside the rates in `src/lib/data/parking.ts`.

---

## 2. What's already in the codebase (build on this, don't reinvent)

- **Custom map features already support a pay link.** `ParkingMeta` in
  [`src/lib/map/types.ts`](../src/lib/map/types.ts) has `paymentMethod`, `paymentLink`,
  `paymentNotes`, and `parkingBlockHtml()` in
  [`src/components/feature-map.tsx`](../src/components/feature-map.tsx) already renders a
  `Payment: <method> · Pay ↗` link (escaped, `target="_blank"`). Chamber-drawn features can
  carry a pay link **today** via the portal map editor.
- **The built-in seed-zone layer does not.** The Port/Diamond zones live as seed data in
  `parkingZones: MapZone[]` ([`src/lib/data/parking.ts`](../src/lib/data/parking.ts)).
  `resolveMapView()` ([`src/lib/map/resolve.ts`](../src/lib/map/resolve.ts)) strips each zone
  down to `{id, name, rule, summary, center, polygon}`, and the built-in-zone popup in
  `feature-map.tsx` shows only **name + summary**. No pay link reaches the real Port/Diamond
  lots.
- **The `/parking` page has no per-lot list.** [`src/app/parking/page.tsx`](../src/app/parking/page.tsx)
  is a server component: a `FeatureMap` (the `parking-cash` CMS view) plus prose. There is no
  scannable "here are the paid lots, tap to pay" surface — which is the highest-value thing to
  add for a ferry rider on a phone.

So Option A = **(1)** add structured pay data to `MapZone`, **(2)** thread it into the built-in
zone popup, and **(3)** add a "Pay for parking" card list on `/parking`. The link builder and QR
are shared.

> ⚠️ **Read `AGENTS.md` first.** This repo runs a Next.js with breaking changes — check
> `node_modules/next/dist/docs/` before writing code. Note the component boundary:
> `feature-map.tsx` is a client component (Leaflet); `parking/page.tsx` is a **server**
> component, so the interactive pay card (copy-to-clipboard, platform detection) must be its own
> `"use client"` component.

---

## 3. Data model

Add a structured hand-off to `MapZone` so the UI never regexes prose. In
[`src/lib/data/parking.ts`](../src/lib/data/parking.ts):

```ts
export type PayVendor = "t2" | "parkmobile" | "paybyphone";

export interface PayHandoff {
  vendor: PayVendor;
  /** T2 keyword ("POKHILL") or ParkMobile/PayByPhone numeric zone ("97599515"). "" if posted-only. */
  code: string;
  /** T2 short code, e.g. "25023". Omit for app/web vendors. */
  shortCode?: string;
  /** Optional human label override for the button, e.g. "Pay with ParkMobile". */
  label?: string;
}

// add to MapZone:
//   /** Payment hand-offs, in preferred order. Omit for free/non-payable zones. */
//   pay?: PayHandoff[];
```

Populate only the paid zones:

```ts
// port-pokpark-*  →  pay: [{ vendor: "t2", code: "POKPARK", shortCode: "25023" }]
// port-pokhill    →  pay: [{ vendor: "t2", code: "POKHILL", shortCode: "25023" }]
// port-poktt      →  pay: [{ vendor: "t2", code: "POKTT",   shortCode: "25023" }]
// diamond-d515    →  pay: [
//   { vendor: "parkmobile", code: "97599515", label: "Pay with ParkMobile" },
//   { vendor: "paybyphone", code: "",         label: "Pay with PayByPhone" },
// ]
```

Leave `washington-blvd-lot` (unverified) and every free/permit/prohibited zone with no `pay`.

**Source of truth:** `parking.ts` seed. If the Chamber later wants to edit codes without a deploy,
mirror `pay` into the map-CMS overlay the same way rates already flow — but v1 keeps it in seed.

---

## 4. The link builder (pure, shared)

New file `src/lib/parking/pay-links.ts`:

```ts
import type { PayHandoff } from "@/lib/data/parking";

/** Build the tap-to-pay href for a hand-off. Pure; safe on server and client. */
export function payHref(p: PayHandoff): string {
  switch (p.vendor) {
    case "t2": {
      const body = encodeURIComponent(p.code); // POKPARK / POKHILL / POKTT
      // Dual `?body=` + `&body=` so whichever separator the OS treats as the query wins
      // (iOS historically used `sms:NUMBER&body=…`, Android/others `sms:NUMBER?body=…`).
      return `sms:${p.shortCode}?body=${body}&body=${body}`;
    }
    case "parkmobile":
      // Web deep-link that pre-fills the zone — verified for D515 (zone 97599515).
      return `https://app.parkmobile.io/zone/start?internalZoneCode=${encodeURIComponent(p.code)}`;
    case "paybyphone":
      // No documented zone-prefill URL — open the app/site; the visible code is the fallback.
      return "https://www.paybyphone.com/";
  }
}

/** Human "how to pay" line shown as tap-to-copy text (the reliable fallback). */
export function payInstruction(p: PayHandoff): string {
  switch (p.vendor) {
    case "t2":        return `Text ${p.code} to ${p.shortCode}`;
    case "parkmobile":return `ParkMobile zone ${p.code}`;
    case "paybyphone":return `PayByPhone — use the location code on the lot sign`;
  }
}
```

**Rendered real values (copy-paste to test):**

```
Port POKPARK:  sms:25023?body=POKPARK&body=POKPARK
Port POKHILL:  sms:25023?body=POKHILL&body=POKHILL
Port POKTT:    sms:25023?body=POKTT&body=POKTT
Diamond D515:  https://app.parkmobile.io/zone/start?internalZoneCode=97599515
```

---

## 5. Surface 1 — the built-in zone popup (map)

Thread `pay` through so the real Port/Diamond zones get a "Pay now" link in their map popup.

1. **`src/lib/map/types.ts`** — add `pay?` to the built-in payload type
   (`ResolvedMapView.builtins.parkingZones[]`): `pay?: PayHandoff[]`.
2. **`src/lib/map/resolve.ts`** (the `parking-zones` block, ~L44) — pass it through:
   ```ts
   builtins.parkingZones = zones.map((z) => ({
     id: z.id, name: z.name, rule: z.rule, summary: z.summary,
     center: z.center, polygon: z.polygon,
     pay: z.pay,          // NEW
   }));
   ```
3. **`src/components/feature-map.tsx`** (built-in zone popup, ~L444) — append a pay link,
   mirroring the existing `parkingBlockHtml` "Pay ↗" style and **using `esc()` on every value**:
   ```ts
   const payRow = (z.pay ?? [])
     .map((p) => `<a href="${esc(payHref(p))}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;margin:6px 8px 0 0;font-weight:600;">
        ${esc(p.label ?? "Pay now")} ↗</a>`)
     .join("");
   const popup = `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
     <p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(z.name)}</p>
     <p style="margin:4px 0 0;">${esc(z.summary)}</p>
     ${payRow ? `<p style="margin:2px 0 0;">${payRow}</p>` : ""}
   </div>`;
   ```
   (Import `payHref` from `@/lib/parking/pay-links`.)

The popup is HTML-string + Leaflet — keep everything through `esc()`; the codes are constants so
there's no injection surface, but stay consistent with the file's convention.

---

## 6. Surface 2 — a "Pay for parking" card list on `/parking` (the important one)

This is the mobile win: a ferry rider scans a short list and taps once. Add a `Section` to
[`src/app/parking/page.tsx`](../src/app/parking/page.tsx) **above "Before you park for the ferry"**,
built from the paid zones (`parkingZones.filter(z => z.pay?.length)`).

Because the page is a server component and the card needs clipboard + platform behavior, put the
interactive part in a small client component:

```tsx
// src/components/parking-pay-card.tsx
"use client";
import { useState } from "react";
import type { MapZone } from "@/lib/data/parking";
import { payHref, payInstruction } from "@/lib/parking/pay-links";

export function ParkingPayCard({ zone }: { zone: MapZone }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-line p-4">
      <h3 className="font-semibold text-ink">{zone.name}</h3>
      <p className="mt-1 text-sm text-ink-soft">{zone.summary}</p>
      <div className="mt-3 flex flex-col gap-2">
        {(zone.pay ?? []).map((p, i) => {
          const instr = payInstruction(p);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <a
                href={payHref(p)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md bg-[#1E96C0] px-4 py-2 text-sm font-semibold text-white"
              >
                {p.label ?? "Pay now"} ↗
              </a>
              {/* Reliable fallback: always show + let them copy the code */}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(p.code || instr);
                  setCopied(instr);
                  setTimeout(() => setCopied(null), 1500);
                }}
                className="text-sm text-ink-soft underline decoration-dotted"
                aria-live="polite"
              >
                {copied === instr ? "Copied ✓" : instr}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Then in the server page:

```tsx
import { parkingZones } from "@/lib/data/parking";
import { ParkingPayCard } from "@/components/parking-pay-card";
// ...
<Section
  title="Pay for parking"
  subtitle="Tap to pay for the paid lots. The Port lots use text-to-pay; the Diamond commuter lot uses ParkMobile or PayByPhone."
>
  <div className="grid gap-3 sm:grid-cols-2">
    {parkingZones.filter((z) => z.pay?.length).map((z) => (
      <ParkingPayCard key={z.id} zone={z} />
    ))}
  </div>
  <p className="mt-2 text-xs text-ink-soft">
    Payment is handled by each lot's own provider — we just open it for you. On a computer the
    text link may not work; scan the code with your phone or note it and text it.
  </p>
</Section>
```

**Register the new headings/subtitle in the copy registry** (`src/lib/site-copy-registry.ts` +
`copyText`) so the Chamber can edit the wording, matching the rest of `/parking`.

De-dupe the three POKPARK rows if you don't want them listed separately — group by
`pay[0].code + shortCode` and show one "Port marina lots" card, since they share the exact same
`sms:` hand-off.

---

## 7. Platform behavior (must handle all three)

| Platform | `sms:` (Port) | ParkMobile link (Diamond) | What we do |
|---|---|---|---|
| **iOS** | Opens Messages to 25023; **body pre-fill unreliable** | Opens app/web to the zone | Always show tap-to-copy "Text POKHILL to 25023" |
| **Android** | Opens SMS app with body pre-filled (reliable) | Opens app/web to the zone | Same fallback text (harmless) |
| **Desktop** | Usually no-ops (except macOS→Messages) | Opens ParkMobile web fine | Show the code **+ a QR** of the `sms:` URI |

The visible instruction text is doing the real work on iOS/desktop — never hide it behind the
button.

---

## 8. QR fallback (desktop) — static, zero-dependency

There are only **four distinct pay links** and they never change per user, so the QR codes are
**static assets**, not runtime-generated. This avoids any runtime dependency and any external
request (the app's CSP forbids external hosts anyway).

- Generate once with a dev-only script using `qrcode` (MIT) as a `devDependency`, emitting SVGs to
  `public/parking/qr/`:
  - `pokpark.svg`, `pokhill.svg`, `poktt.svg` (encode the `sms:` URIs)
  - `diamond-d515.svg` (encode the ParkMobile URL)
- Show the QR **only on desktop / wide viewport** (`hidden sm:block` won't do — key off a
  no-touch / pointer:fine media query, or just always offer a small "Show QR" toggle). Mobile
  users tap the link directly.
- **Do not** generate a ParkMobile/PayByPhone-*branded* QR — both vendors warn about fake-QR
  overlays. Encoding our own `sms:` hand-off or the plain zone-start URL is fine.

Script sketch (`scripts/gen-parking-qr.mjs`, run manually, commit output):

```js
import QRCode from "qrcode";
import { writeFile, mkdir } from "node:fs/promises";
const links = {
  pokpark: "sms:25023?body=POKPARK&body=POKPARK",
  pokhill: "sms:25023?body=POKHILL&body=POKHILL",
  poktt:   "sms:25023?body=POKTT&body=POKTT",
  "diamond-d515": "https://app.parkmobile.io/zone/start?internalZoneCode=97599515",
};
await mkdir("public/parking/qr", { recursive: true });
for (const [name, url] of Object.entries(links)) {
  await writeFile(`public/parking/qr/${name}.svg`, await QRCode.toString(url, { type: "svg" }));
}
```

---

## 9. Testing checklist

- [ ] `pnpm tsc --noEmit` and lint clean.
- [ ] **Real iPhone**: `/parking` pay card → Messages opens to 25023 (body may/may not fill);
      tap-to-copy works; ParkMobile link opens app or web to the D515 zone.
- [ ] **Real Android**: `sms:` opens with **POKHILL pre-filled**; ParkMobile link works.
- [ ] **Desktop**: `sms:` link degrades gracefully; code visible; QR renders and scans from a phone.
- [ ] Map popup ("parking-cash" view) shows "Pay now ↗" on Port + Diamond zones only, not on
      free/permit zones.
- [ ] Copy-registry blocks resolve; Chamber can edit the section title/subtitle in the portal.
- [ ] Verify the ParkMobile `internalZoneCode=97599515` still lands on the D515 pay flow (it's
      unofficial — this is the thing most likely to drift).

---

## 10. Out of scope (this is Option A)

- **In-app payment / session status / usage data** — needs Option B (Port-sponsored T2 Systems
  integration; the Port must initiate with its T2 account manager — third parties can't
  self-serve). See the Chamber → Port proposal and the LTAC brief.
- **PayByPhone zone pre-fill** — no documented URL; stays an out-link + posted code.
- **Passport** — no Kingston operator; not applicable unless the Port migrates vendors.

## Verify-before-relying (facts that can drift)

- iOS `sms:` body pre-fill behavior (changes across iOS versions) — fallback text covers it.
- ParkMobile `internalZoneCode` URL format and the D515 zone number `97599515`.
- Port zone codes POKPARK / POKHILL / POKTT and short code 25023 (re-confirm with the Port; see
  the Chamber proposal's ask #3).
