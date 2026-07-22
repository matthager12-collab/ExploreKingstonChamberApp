import { KioskQr, displayHost } from "@/components/kiosk-qr";
import { KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { kioskHandoffUrl } from "@/lib/qr";
import { getLodging } from "@/lib/stores/listing-stores";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// Somewhere to stay, kiosk-scaled.
//
// Default OFF in the kiosk settings (see DEFAULT_ENABLED_SCREENS): the audience
// at the dock is mostly walking onto a boat, not looking for a room. It exists
// so the Chamber can switch it on for a shoulder-season or festival weekend
// without a deploy.
//
// Booking links are QR only. A reservation flow started on a shared panel and
// abandoned half-finished is the worst possible outcome for both the visitor
// and the business.

export const revalidate = 60;

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  "vacation-rental": "Vacation rental",
  bnb: "Bed & breakfast",
  camping: "Camping",
  marina: "Marina",
};

export default async function KioskStayPage() {
  const [lodging, copy] = await Promise.all([getLodging(), getCopyOverrides()]);

  return (
    <KioskScreen title="Stay" subtitle="Rooms, rentals, and moorage around Kingston">
      <div className="mb-10 flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/stay")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          Every place to stay, with booking links, on your own phone.
        </p>
      </div>

      {lodging.length === 0 ? (
        <KioskEmpty>
          The lodging list is briefly unavailable. The Chamber office across the road can help.
        </KioskEmpty>
      ) : (
        lodging.map((l) => {
          const offsite = l.bookingUrl ?? l.website ?? null;
          return (
            <KioskCard
              key={l.id}
              title={l.name}
              meta={`${TYPE_LABEL[l.type] ?? l.type}${l.address ? ` · ${l.address}` : ""}`}
              body={l.description}
              aside={
                offsite ? (
                  <KioskQr
                    value={offsite}
                    caption="Book on your phone"
                    hint={displayHost(offsite)}
                    size="sm"
                  />
                ) : undefined
              }
            />
          );
        })
      )}
    </KioskScreen>
  );
}
