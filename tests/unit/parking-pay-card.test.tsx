// @vitest-environment jsdom
// The pay card is the surface a visitor acts on with money involved, so what
// is asserted here is mostly about what it must never do: hide the code behind
// the button, put a pay button on a free lot, or credit the wrong operator.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { parkingZones, type MapZone } from "@/lib/data/parking";
import { payGroupKey } from "@/lib/parking/pay-links";
import {
  ParkingPayCard,
  payCardNote,
  payCardTitle,
  spacesLabel,
} from "@/components/parking-pay-card";

const zoneById = (id: string): MapZone => {
  const z = parkingZones.find((x) => x.id === id);
  if (!z) throw new Error(`no zone ${id}`);
  return z;
};

const POKPARK = parkingZones.filter(
  (z) => z.pay?.[0]?.vendor === "t2" && z.pay[0].code === "POKPARK",
);

describe("payCardTitle", () => {
  // Titling a grouped card from its first zone gave "north rows" — a fragment
  // of a map label, not something a driver would ever say.
  it("names a grouped card by its pay code, not the first zone's name", () => {
    expect(payCardTitle(POKPARK)).toBe("General parking");
    expect(payCardTitle([zoneById("port-pokhill")])).toBe("Hill parking");
    expect(payCardTitle([zoneById("port-poktt")])).toBe("Truck & trailer parking");
  });

  it("falls back to the zone name for a single named lot", () => {
    expect(payCardTitle([zoneById("diamond-d515")])).toBe("Diamond lot D515");
  });
});

describe("payCardNote", () => {
  it("keeps the rate and drops what the card already shows", () => {
    const note = payCardNote(zoneById("port-pokhill"))!;
    expect(note).toContain("$12/12 hr");
    expect(note).not.toMatch(/text POKHILL/i);
    expect(note).not.toMatch(/spaces/i);
  });
});

describe("spacesLabel", () => {
  it("merges and sorts the ranges across a group", () => {
    expect(spacesLabel(POKPARK)).toBe("1–88, 89–103, 181–233, 201–213");
  });

  it("is absent for a lot with no numbered spaces", () => {
    expect(spacesLabel([zoneById("diamond-d515")])).toBeUndefined();
  });
});

describe("ParkingPayCard", () => {
  it("shows the code as text, not only as a link target", () => {
    render(
      <ParkingPayCard title="General parking" pay={zoneById("port-pokhill").pay!} />,
    );
    // The load-bearing assertion: on iOS the sms: body pre-fill is unreliable
    // and on desktop the scheme no-ops, so this sentence is what actually works.
    expect(screen.getByText("Text POKHILL to 25023")).toBeTruthy();
  });

  it("points the button at the sms: hand-off", () => {
    const { container } = render(
      <ParkingPayCard title="Hill" pay={zoneById("port-pokhill").pay!} />,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("sms:25023?body=POKHILL&body=POKHILL");
  });

  it("renders one button per hand-off", () => {
    const { container } = render(
      <ParkingPayCard title="Diamond" pay={zoneById("diamond-d515").pay!} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("renders the QR inline, with no network request", () => {
    const { container } = render(
      <ParkingPayCard title="Hill" pay={zoneById("port-pokhill").pay!} />,
    );
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).toBeTruthy();
    // No <img>, so nothing to fetch and nothing for a CSP to allow.
    expect(container.querySelector("img")).toBeNull();
    expect(svg?.getAttribute("aria-label")).toContain("Text POKHILL to 25023");
  });

  it("renders nothing rather than an empty shell when there is no hand-off", () => {
    const { container } = render(<ParkingPayCard title="Free lot" pay={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("grouping", () => {
  it("collapses the Port's three POKPARK polygons into one card", () => {
    const keys = new Set(POKPARK.map((z) => payGroupKey(z.pay!)));
    expect(POKPARK.length).toBe(3);
    expect(keys.size).toBe(1);
  });
});
