import { KioskQr, displayHost } from "@/components/kiosk-qr";
import { KioskBadge, KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { getOpenStatus } from "@/lib/hours";
import { kioskHandoffUrl } from "@/lib/qr";
import { getRestaurants } from "@/lib/stores/business-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// Eat & Drink, kiosk-scaled.
//
// Ordered by walk time from the ferry, because the question behind this screen
// is almost always "can I get food before the boat". getRestaurants() is the
// PUBLIC read, so only moderated live records reach the panel — the same
// guarantee the website has, inherited rather than re-implemented (FR-A01).
//
// Every off-site destination — a menu, an ordering page — is a QR, never a
// link. Tapping through to a restaurant's own website on the kiosk itself is
// how a wall-mounted panel ends up parked on someone's cookie banner.

export const revalidate = 60;

export default async function KioskEatPage() {
  const [restaurants, copy] = await Promise.all([getRestaurants(), getCopyOverrides()]);
  const open = restaurants
    .filter((r) => !r.hidden)
    .sort((a, b) => a.walkMinutesFromFerry - b.walkMinutesFromFerry);

  return (
    <KioskScreen title="Eat & Drink" subtitle="Everything here is a walk from the ferry">
      <div className="mb-10 flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/eat")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          The full list, with menus and live opening hours, on your own phone.
        </p>
      </div>

      {open.length === 0 ? (
        <KioskEmpty>
          The restaurant list is briefly unavailable. The Chamber office across the road can point
          you at what is open.
        </KioskEmpty>
      ) : (
        open.map((r) => {
          const status = r.weeklyHours ? getOpenStatus(r.weeklyHours) : null;
          // One QR per card, and the menu is what a hungry person actually
          // wants. Ordering and website are the fallbacks, in that order.
          const offsite = r.menuUrl ?? r.orderingUrl ?? r.website ?? null;
          return (
            <KioskCard
              key={r.id}
              title={r.name}
              badge={
                status ? (
                  <KioskBadge tone={status.open ? "open" : "shut"}>{status.label}</KioskBadge>
                ) : undefined
              }
              meta={`${r.cuisine} · ${r.walkMinutesFromFerry} min walk${
                r.address ? ` · ${r.address}` : ""
              }`}
              body={r.description}
              aside={
                offsite ? (
                  <KioskQr value={offsite} caption="Menu on your phone" hint={displayHost(offsite)} size="sm" />
                ) : undefined
              }
            />
          );
        })
      )}
    </KioskScreen>
  );
}
