# Parking "Pay now" out-links (Option A)

**Status:** proposed / not yet built · **Cost:** $0 · **Effort:** ~1–1.5 days · **Owner:** Mat

The free, no-backend way to make paying for Kingston parking one tap from the app. This is
"Option A" from the July 2026 PassportParking research (workflow `wf_76e8dc6f-f25`). It ships
value now; the paid **Option B** (a Port-sponsored T2 Systems integration) is a separate,
next-budget-year track — see `docs/chamber/`.

---

## Requirements

- **R1 — One-tap pay for each paid lot.** Each paid parking area gets a "Pay now" hand-off that
  opens the visitor's phone to the correct vendor, pre-loaded with the zone code, plus a visible
  code as fallback.
- **R2 — Payment settings must be admin-editable in the parking-map setup section
  (`/admin/map`), no code deploy.** Vendor, zone code, short code, and button label for each area
  are configured by a Chamber admin in the same editor used to draw the zones, and stored in the
  existing `parking-zones` overlay store. When the Port changes a code or switches vendors, the
  Chamber edits it in the portal and it's live within ~a minute. **Nothing payment-related is
  hardcoded as the only source of truth** — the seed file only supplies sensible defaults.
- **R3 — Graceful degradation.** The undocumented bits (iOS `sms:` body pre-fill, ParkMobile
  `internalZoneCode`) may drift, so the visible code/short-code text always shows and the feature
  degrades to "here's the code, text it yourself" rather than breaking.
- **R4 — $0 / no backend / no partnership.** We only surface payment rails the operators already
  run. No money moves through our app; no API key; no external network calls (respect the app's
  CSP — no third-party QR service, no vendor-branded QR).

R2 is the load-bearing new requirement: **codes drift** (the Port revises rates/zones and the
parking data is flagged "re-verify quarterly"), so the codes have to live where the Chamber can
change them, next to where they already drag the shapes.

---

## 1. Why this shape (the vendor reality)

**We do not integrate PassportParking.** Passport is not a vendor in Kingston. Each paid lot
already runs on a payment system with a public consumer flow; the app just needs to *hand the
user off to the right one*, pre-loaded with the zone code.

| Lot (`MapZone` id) | Vendor | Hand-off the app builds | Default code |
|---|---|---|---|
| `port-pokpark-north-rows`, `port-pokpark-main-fan`, `port-pokpark-89-103` | T2 MobilePay (text-to-pay) | `sms:` → text code to short code | `POKPARK` → `25023` |
| `port-pokhill` | T2 MobilePay | `sms:` | `POKHILL` → `25023` |
| `port-poktt` | T2 MobilePay | `sms:` | `POKTT` → `25023` |
| `diamond-d515` | ParkMobile + PayByPhone | ParkMobile web deep-link; PayByPhone out-link | ParkMobile zone `97599515` |
| free 2-hr / unrestricted streets, park & rides, permit/tenant/prohibited zones | — | **no button** | — |

These are **defaults**, not the source of truth — per R2 they seed the field and are then
editable in `/admin/map`.

---

## 2. What's already in the codebase (build on this, don't reinvent)

- **The overlay store for parking zones already exists.** `src/lib/stores/parking-store.ts`
  merges the `parking.ts` seed with admin overlay records (`readMerged<MapZone>("parking-zones",
  seed)`); `saveParkingZone()` writes an overlay record, `_deleted` tombstones. The admin API
  `POST /api/admin/parking` and the geoman editor at `/admin/map`
  ([`src/app/(site)/admin/map/editor.tsx`](../src/app/(site)/admin/map/editor.tsx)) are the "parking-map area
  setup" section named in R2. **We extend this existing pipe — we don't build a new one.**
- **Custom map features already carry an editable pay link.** `ParkingMeta` in
  [`src/lib/map/types.ts`](../src/lib/map/types.ts) has `paymentMethod` / `paymentLink` /
  `paymentNotes`, and `parkingBlockHtml()` in
  [`src/components/feature-map.tsx`](../src/components/feature-map.tsx) already renders a
  `Payment · Pay ↗` link. This work brings the **same editable pay hand-off to the built-in
  Port/Diamond zones** (which are seed data, not custom features).
- **⚠️ The admin save currently strips unknown fields.** `POST /api/admin/parking`
  ([`route.ts:144`](../src/app/api/admin/parking/route.ts)) **rebuilds** the `MapZone` from a fixed
  whitelist (`id, name, rule, summary, details, confidence, overnight, center, polygon,
  sourceUrl, sourceNote`). Anything else — including a new `pay` field — is dropped on save. So
  even a geometry drag would wipe `pay` unless the API is taught to keep it. **Fixing the API is
  mandatory, not optional** (see §6).
- **The `/parking` page has no per-lot list.** [`src/app/(site)/parking/page.tsx`](../src/app/(site)/parking/page.tsx)
  is a server component: a `FeatureMap` (the `parking-cash` CMS view) plus prose. There's no
  scannable "here are the paid lots, tap to pay" surface — the highest-value thing to add for a
  ferry rider on a phone.

> ⚠️ **Read `AGENTS.md` first.** This repo runs a Next.js with breaking changes — check
> `node_modules/next/dist/docs/` before writing code. Component boundary: `feature-map.tsx` and
> `admin/map/editor.tsx` are client components; `parking/page.tsx` is a **server** component, so
> the interactive pay card (copy-to-clipboard, QR) must be its own `"use client"` component.

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
  /** Optional button label override, e.g. "Pay with ParkMobile". */
  label?: string;
}

// add to MapZone:
//   /** Payment hand-offs, in preferred order. Omit for free/non-payable zones.
//       SEED DEFAULT ONLY — admin-editable via /admin/map (parking-zones overlay). */
//   pay?: PayHandoff[];
```

Seed the paid zones with the defaults from the §1 table (POKPARK/POKHILL/POKTT → 25023; Diamond →
ParkMobile 97599515 + PayByPhone). Leave `washington-blvd-lot` (unverified) and every
free/permit/prohibited zone with no `pay`.

**Source of truth = the merged store (`getParkingZones()`), not the seed import.** The seed is
just the default an admin can override. Every consumer (map popup, page card list) must read the
merged zones so admin edits show — see §5–§7.

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
      return `sms:${encodeURIComponent(p.shortCode ?? "")}?body=${body}&body=${body}`;
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
    case "t2":         return `Text ${p.code} to ${p.shortCode}`;
    case "parkmobile": return `ParkMobile zone ${p.code}`;
    case "paybyphone": return `PayByPhone — use the location code on the lot sign`;
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

1. **`src/lib/map/types.ts`** — add `pay?: PayHandoff[]` to the built-in payload type
   (`ResolvedMapView.builtins.parkingZones[]`).
2. **`src/lib/map/resolve.ts`** (the `parking-zones` block, ~L44) — pass it through (the source is
   already the merged `getParkingZones()`, so admin edits flow automatically):
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

---

## 6. Surface 2 — make it editable in `/admin/map` (Requirement R2)

This is the new, load-bearing part. Two changes: teach the API to keep `pay`, and add fields to
the editor.

### 6a. API — persist & validate `pay` (`src/app/api/admin/parking/route.ts`)

The POST handler rebuilds the zone; add validated `pay` to it so a save never wipes it. Validate
tightly (the code goes into an `sms:` body and the short code is the recipient):

```ts
const VENDORS = ["t2", "parkmobile", "paybyphone"] as const;

function sanitizePay(input: unknown): PayHandoff[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: PayHandoff[] = [];
  for (const raw of input.slice(0, 4)) {                 // cap at 4 hand-offs
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const vendor = r.vendor as PayHandoff["vendor"];
    if (!VENDORS.includes(vendor)) continue;
    // code: letters/digits/space/dash only, ≤ 32 chars (safe in an sms: body & zone URL)
    const code = typeof r.code === "string" ? r.code.trim().slice(0, 32) : "";
    if (code && !/^[A-Za-z0-9 -]+$/.test(code)) continue;
    const shortCode =
      typeof r.shortCode === "string" && /^[0-9]{3,8}$/.test(r.shortCode.trim())
        ? r.shortCode.trim() : undefined;
    const label =
      typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 40) : undefined;
    out.push({ vendor, code, ...(shortCode ? { shortCode } : {}), ...(label ? { label } : {}) });
  }
  return out.length ? out : undefined;
}

// …then in the constructed `zone` object:
const pay = sanitizePay(body.pay);
const zone: MapZone = {
  id, name, rule, summary, details, confidence, overnight, center,
  ...(polygon ? { polygon } : {}),
  ...(sourceUrl ? { sourceUrl } : {}),
  ...(sourceNote ? { sourceNote } : {}),
  ...(pay ? { pay } : {}),          // NEW — without this, every save strips pay
};
```

### 6b. Editor — add pay fields (`src/app/(site)/admin/map/editor.tsx`)

- Extend the `Draft` type with `pay: PayHandoff[]`; `toDraft(zone)` sets `pay: zone.pay ?? []`;
  `buildZone()` sets `pay: draft.pay` (it already spreads `...zone`, but set it explicitly so an
  emptied list persists as removed).
- Add a "Payment" block to the zone form (after Overnight/Confidence) — a repeatable list of
  hand-off rows, each with: a **vendor** `<select>` (Text-to-pay / ParkMobile / PayByPhone), a
  **code** input, a **short code** input (shown only when vendor = T2), an optional **label**, and
  a remove button, plus "＋ Add payment option". Use `patchDraft({ pay })` on change so the
  existing dirty/Save flow just works. A tiny live preview (`payInstruction(p)` + the built
  `payHref`) helps the admin confirm before saving.

Sketch:

```tsx
// inside the selected-zone form
<div className="mt-4">
  <span className="text-sm font-medium text-ink">Payment options (tap-to-pay)</span>
  {draft.pay.map((p, i) => (
    <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr_120px_auto]">
      <select className={INPUT} value={p.vendor}
        onChange={(e) => patchPay(i, { vendor: e.target.value as PayVendor })}>
        <option value="t2">Text-to-pay (T2)</option>
        <option value="parkmobile">ParkMobile</option>
        <option value="paybyphone">PayByPhone</option>
      </select>
      <input className={INPUT} placeholder="Code (POKHILL / 97599515)"
        value={p.code} onChange={(e) => patchPay(i, { code: e.target.value })} />
      {p.vendor === "t2" && (
        <input className={INPUT} placeholder="Short code (25023)"
          value={p.shortCode ?? ""} onChange={(e) => patchPay(i, { shortCode: e.target.value })} />
      )}
      <button type="button" onClick={() => removePay(i)} className="text-coral-deep">✕</button>
    </div>
  ))}
  <button type="button" className="mt-2 text-sm text-sound underline"
    onClick={() => patchDraft({ pay: [...draft.pay, { vendor: "t2", code: "", shortCode: "25023" }] })}>
    ＋ Add payment option
  </button>
</div>
```

(`patchPay`/`removePay` are trivial helpers that map over `draft.pay` and call `patchDraft`.)

**Net effect:** the Chamber sets/changes any lot's vendor + code in the same screen where they
drag the shape; it saves to the `parking-zones` overlay and is live on `/parking` within ~a
minute — no deploy. That satisfies R2.

---

## 7. Surface 3 — a "Pay for parking" card list on `/parking`

The mobile win: a ferry rider scans a short list and taps once. Add a `Section` to
[`src/app/(site)/parking/page.tsx`](../src/app/(site)/parking/page.tsx) **above "Before you park for the ferry"**,
built from the **merged** zones (so admin edits show):

```tsx
import { getParkingZones } from "@/lib/stores/parking-store";   // merged seed + overlay
import { ParkingPayCard } from "@/components/parking-pay-card";
// in the async page:
const zones = await getParkingZones();
const payable = zones.filter((z) => z.pay?.length);
// …
<Section title="Pay for parking"
  subtitle="Tap to pay for the paid lots. The Port lots use text-to-pay; the Diamond commuter lot uses ParkMobile or PayByPhone.">
  <div className="grid gap-3 sm:grid-cols-2">
    {payable.map((z) => <ParkingPayCard key={z.id} zone={z} />)}
  </div>
</Section>
```

The `"use client"` card (`src/components/parking-pay-card.tsx`) renders, per hand-off: a **"Pay
now" button** (`href={payHref(p)}`), a **tap-to-copy code** line (`payInstruction(p)` — the
reliable fallback, always visible), and on desktop a **QR** (see §9). Register the section
title/subtitle in the copy registry (`src/lib/site-copy-registry.ts` + `copyText`) so wording is
Chamber-editable too. De-dupe the three POKPARK rows into one "Port marina lots" card if you don't
want them listed separately (group by `vendor+code+shortCode`).

---

## 8. Platform behavior (must handle all three)

| Platform | `sms:` (Port) | ParkMobile link (Diamond) | What we do |
|---|---|---|---|
| **iOS** | Opens Messages to short code; **body pre-fill unreliable** | Opens app/web to the zone | Always show tap-to-copy "Text POKHILL to 25023" |
| **Android** | Opens SMS app with body pre-filled (reliable) | Opens app/web to the zone | Same fallback text (harmless) |
| **Desktop** | Usually no-ops (except macOS→Messages) | Opens ParkMobile web fine | Show the code **+ a QR** of the `sms:` URI |

The visible instruction text does the real work on iOS/desktop — never hide it behind the button.

---

## 9. QR fallback (desktop) — generated at runtime, not build time

**Because codes are now admin-editable (R2), the QR cannot be a static build-time asset** — it
must reflect whatever the admin last set. Generate it **client-side from the live `payHref(p)`**,
so it always matches the current code with no rebuild:

- Bundle a small QR generator (e.g. `qrcode` used in the browser to emit an inline SVG/canvas) as
  a normal dependency. It runs entirely locally — **no external request**, satisfying the CSP /
  R4. Do **not** call any hosted QR image service.
- Render only on desktop / wide viewport (mobile taps the link directly). A "Show QR" toggle is
  fine.
- Encode our own `sms:` hand-off or the plain ParkMobile zone-start URL — **never** a
  vendor-*branded* QR (ParkMobile/PayByPhone warn about fake-QR overlays).

---

## 10. Testing checklist

- [ ] `pnpm tsc --noEmit` and lint clean.
- [ ] **R2 round-trip:** in `/admin/map`, edit a Port zone's code (e.g. POKHILL → POKTEST), Save →
      the `/parking` card and the map popup show the new code within a minute, **with no deploy**.
- [ ] **No-wipe:** select a zone with `pay`, drag its shape only, Save → `pay` survives (proves
      the API fix in §6a). Before the fix this is the regression to catch.
- [ ] **Real iPhone**: pay card → Messages opens to the short code (body may/may not fill);
      tap-to-copy works; ParkMobile link opens app/web to the D515 zone.
- [ ] **Real Android**: `sms:` opens with the code pre-filled; ParkMobile link works.
- [ ] **Desktop**: `sms:` degrades gracefully; code visible; QR renders (from live data) and scans.
- [ ] Map popup shows "Pay now ↗" on Port + Diamond zones only, not on free/permit zones.
- [ ] Validation: the API rejects a bad short code / oversized code and never persists junk.

---

## 11. Out of scope (this is Option A)

- **In-app payment / session status / usage data** — needs Option B (Port-sponsored T2 Systems
  integration; the Port must initiate with its T2 account manager). See the Chamber → Port
  proposal and the LTAC brief in `docs/chamber/`.
- **PayByPhone zone pre-fill** — no documented URL; stays an out-link + posted code.
- **Passport** — no Kingston operator; not applicable unless the Port migrates vendors.
- **Global vendor defaults** (e.g. one shared T2 short code edited once) — nice future ergonomics,
  but per-zone `pay` editing already meets R2; skip for v1.

## Verify-before-relying (facts that can drift — hence R2)

- iOS `sms:` body pre-fill behavior (changes across iOS versions) — fallback text covers it.
- ParkMobile `internalZoneCode` URL format and the D515 zone number `97599515`.
- Port zone codes POKPARK / POKHILL / POKTT and short code 25023 — now Chamber-editable in
  `/admin/map`; re-confirm with the Port (see the Chamber proposal's ask #3).
