import { KioskQr } from "@/components/kiosk-qr";
import { KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { resolveMapView } from "@/lib/map/resolve";
import { kioskHandoffUrl } from "@/lib/qr";
import { getItineraries } from "@/lib/stores/itinerary-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// Things to do, kiosk-scaled.
//
// Two sources, in the order they are useful to someone with time to fill: the
// Chamber's ready-made day plans, then individual places worth walking to from
// the trails map. Both are ordinary public store reads, so anything unpublished
// or awaiting moderation is absent here exactly as it is on the website.
//
// Default OFF in the kiosk settings, like Stay — seven tiles is more than a
// hurried person reads, and this one serves a visitor who has already decided
// to stay a while.

export const revalidate = 60;

const TRAILS_VIEW = "trails";

export default async function KioskDoPage() {
  const [itineraries, trails, copy] = await Promise.all([
    getItineraries(),
    resolveMapView(TRAILS_VIEW).catch(() => null),
    getCopyOverrides(),
  ]);

  const outdoors = (trails?.features ?? []).slice(0, 8);

  return (
    <KioskScreen title="Things to do" subtitle="If you have an hour, or a whole day">
      <div className="mb-10 flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/itineraries")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          Ready-made day plans you can follow from your phone as you walk.
        </p>
      </div>

      {itineraries.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-6 text-4xl font-semibold text-white/80">Ready-made plans</h2>
          {itineraries.slice(0, 6).map((it) => (
            <KioskCard
              key={it.id}
              title={it.title}
              meta={`${it.duration} · ${it.mode === "walk-on" ? "On foot from the ferry" : it.mode === "car" ? "Bring the car" : "Car or on foot"}`}
              body={it.tagline}
            />
          ))}
        </section>
      )}

      <h2 className="mb-6 text-4xl font-semibold text-white/80">Outside</h2>
      {outdoors.length === 0 ? (
        <KioskEmpty>
          The trails list is briefly unavailable — scan the code above for day plans and walks.
        </KioskEmpty>
      ) : (
        outdoors.map((f) => <KioskCard key={f.id} title={f.title} body={f.notes} />)
      )}
    </KioskScreen>
  );
}
