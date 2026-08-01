import { Callout, Card, ExternalLink, Section, mapDirectionsUrl } from "@/components/ui";
import {
  edmondsNoParkPlace,
  edmondsOption,
  type EdmondsParkingOption,
} from "@/lib/data/edmonds-parking";
import { fillSafetyText, safetyValues } from "@/lib/i18n/safety-content";
import { copyText } from "@/lib/stores/site-store";

// The Edmonds-side section of /parking — the owner ask (2026-08-01): "call out
// parking on the edmonds side. that way people who want to walk on can."
//
// Synchronous on purpose, like accessibility/statement.tsx: the page resolves
// the copy overlay and the fares record and hands both in, so
// tests/unit/edmonds-parking.test.tsx can renderToStaticMarkup this component
// directly (an async page cannot be rendered that way).
//
// NO MAP, deliberately: the self-hosted PMTiles cover a downtown-Kingston
// bbox and Edmonds is outside it (widening is an ADR-0006 parameter decision,
// not tonight's). Cards + Google-Maps directions deep links instead.
//
// {walkOnRoundTrip} is the E27 fare token — same record, same fallback rule as
// /ferry, /simple and /es: a figure nobody confirmed renders as "the fare
// posted at Edmonds", never as a stale number. Facts and per-card sources come
// from src/lib/data/edmonds-parking.ts (research verified 2026-07-31);
// sentences are Chamber-editable copy (the edmonds.* registry block).

/** The two links every option card carries: directions out, source down. */
function OptionLinks({ option }: { option: EdmondsParkingOption }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1">
      <ExternalLink
        href={mapDirectionsUrl(option.directionsDestination, option.directionsMode)}
        className="inline-flex min-h-[44px] items-center text-sm"
      >
        Directions in Google Maps
      </ExternalLink>
      {/* Same plain-anchor source-link pattern as the P&R cards above on this page. */}
      <a
        href={option.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-tide-deep underline"
      >
        {`${option.sourceLabel} →`}
      </a>
    </div>
  );
}

export function EdmondsSideParking({
  copy,
  walkOnRoundTrip,
}: {
  copy: Record<string, string>;
  /** walkOnRoundTripFare(ferryInfo.fares) — null when no confirmed figure exists. */
  walkOnRoundTrip: string | null;
}) {
  // The fare sentence goes through the same token fill as /simple and /es, so
  // all the pages that quote this figure mid-sentence agree, including about
  // what "no confirmed figure" looks like.
  const fare = fillSafetyText(
    copyText(copy, "edmonds.fare"),
    safetyValues("en", {
      phone: copyText(copy, "contact.phone.number"),
      walkOnRoundTrip,
    }),
  );

  const upark = edmondsOption("upark");
  const shortTerm = edmondsOption("short-term");
  const bus = edmondsOption("bus");

  // Data (names, sources) paired with sentences (copy registry) per item.
  // Spelled out entry by entry because copy keys must be string literals —
  // the registry test rejects dynamic keys.
  const avoid = [
    { place: edmondsNoParkPlace("salish-crossing"), body: copyText(copy, "edmonds.avoid.salish") },
    {
      place: edmondsNoParkPlace("harbor-square"),
      body: copyText(copy, "edmonds.avoid.harborsquare"),
    },
    { place: edmondsNoParkPlace("port-lots"), body: copyText(copy, "edmonds.avoid.portlots") },
    { place: edmondsNoParkPlace("sounder-lot"), body: copyText(copy, "edmonds.avoid.sounder") },
    { place: edmondsNoParkPlace("terminal"), body: copyText(copy, "edmonds.avoid.terminal") },
  ];

  return (
    <Section
      id="edmonds"
      title={copyText(copy, "edmonds.section.title")}
      subtitle={copyText(copy, "edmonds.section.subtitle")}
    >
      <p className="max-w-2xl text-ink">{fare}</p>

      {/* The research's own hierarchy: the one real all-day option first, then
          the short-term legal backbone. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold text-sound-deep">{upark.name}</h3>
          <p className="mt-2 text-sm text-ink">{copyText(copy, "edmonds.upark.summary")}</p>
          <OptionLinks option={upark} />
        </Card>
        <Card>
          <h3 className="text-lg font-semibold text-sound-deep">{shortTerm.name}</h3>
          <p className="mt-2 text-sm text-ink">{copyText(copy, "edmonds.shortterm.summary")}</p>
          <OptionLinks option={shortTerm} />
        </Card>
      </div>

      {/* Prohibitions are first-class content: each of these is a tow or an
          impound a visitor avoids, so each carries its own source. */}
      <div className="mt-5">
        <Callout tone="coral" title={copyText(copy, "edmonds.avoid.title")}>
          <p>{copyText(copy, "edmonds.avoid.intro")}</p>
          <ul className="mt-2 space-y-2">
            {avoid.map(({ place, body }) => (
              <li key={place.id}>
                <strong className="text-ink">{place.name}.</strong> {body}{" "}
                <a
                  href={place.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-tide-deep underline"
                >
                  {`${place.sourceLabel} →`}
                </a>
              </li>
            ))}
          </ul>
        </Callout>
      </div>

      {/* The bus-in alternative, and — beside it — the honest gap: multi-day
          walk-on parking has no verified option, and the section says so
          rather than letting silence imply one exists. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold text-sound-deep">{bus.name}</h3>
          <p className="mt-2 text-sm text-ink">{copyText(copy, "edmonds.bus.summary")}</p>
          <OptionLinks option={bus} />
        </Card>
        <Callout title={copyText(copy, "edmonds.multiday.title")}>
          <p>{copyText(copy, "edmonds.multiday.body")}</p>
        </Callout>
      </div>
    </Section>
  );
}
