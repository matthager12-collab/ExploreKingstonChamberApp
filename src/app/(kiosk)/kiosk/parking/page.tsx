import { KioskQr } from "@/components/kiosk-qr";
import { KioskBadge, KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { kioskHandoffUrl } from "@/lib/qr";
import { getParkingZones } from "@/lib/stores/parking-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// Where to leave the car, kiosk-scaled.
//
// NO PAY LINKS ON THE KIOSK, deliberately. The website offers `sms:` and
// deep-link "pay now" affordances for the Port and Diamond lots; neither means
// anything on a wall-mounted panel with no SIM and no app store, and a payment
// flow started on a shared device is a genuinely bad idea. The kiosk explains
// the rules and hands the pay page to the visitor's own phone by QR.

export const revalidate = 60;

export default async function KioskParkingPage() {
  const [zones, copy] = await Promise.all([getParkingZones(), getCopyOverrides()]);

  return (
    <KioskScreen title="Parking" subtitle="Where you can leave the car, and for how long">
      <div className="mb-10 flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/parking")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          The parking map, the current rates, and how to pay — on your own phone.
        </p>
      </div>

      {zones.length === 0 ? (
        <KioskEmpty>
          Parking information is briefly unavailable. Signs are posted at each lot entrance.
        </KioskEmpty>
      ) : (
        zones.map((z) => (
          <KioskCard
            key={z.id}
            title={z.name}
            badge={
              // Overnight is the single most expensive thing to get wrong here:
              // a visitor who leaves a car overnight on a "no" lot comes back to
              // a ticket. So it is a badge, not a sentence in the body text.
              <KioskBadge tone={z.overnight === "yes" ? "open" : z.overnight === "no" ? "shut" : "info"}>
                {z.overnight === "yes"
                  ? "Overnight OK"
                  : z.overnight === "no"
                    ? "No overnight"
                    : "Check signs for overnight"}
              </KioskBadge>
            }
            meta={z.summary}
            body={
              // Say so when we are not certain. The alternative is a confident
              // sentence that costs somebody a ticket.
              z.confidence === "verified"
                ? z.details
                : `${z.details} — please check the posted signs, this one is not fully verified.`
            }
          />
        ))
      )}
    </KioskScreen>
  );
}
