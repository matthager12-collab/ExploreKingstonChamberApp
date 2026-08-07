import { describe, expect, it } from "vitest";

import { parkingZones, type PayHandoff } from "@/lib/data/parking";
import {
  payGroupKey,
  payHref,
  payInstruction,
  payLabel,
} from "@/lib/parking/pay-links";
import { isAllowedPaymentLink } from "@/lib/map/payment-link";

const T2: PayHandoff = { vendor: "t2", code: "POKHILL", shortCode: "25023" };

describe("payHref", () => {
  it("builds the T2 text-to-pay link the Port's sign describes", () => {
    expect(payHref(T2)).toBe("sms:25023?body=POKHILL&body=POKHILL");
  });

  // Neither separator is specified and the two platforms disagreed
  // historically. Carrying both is the whole trick; losing one would ship a
  // blank message to half of all phones.
  it("carries both query separators for iOS and Android", () => {
    const href = payHref(T2);
    expect(href).toContain("?body=POKHILL");
    expect(href).toContain("&body=POKHILL");
  });

  it("pre-fills the ParkMobile zone", () => {
    expect(payHref({ vendor: "parkmobile", code: "97599515" })).toBe(
      "https://app.parkmobile.io/zone/start?internalZoneCode=97599515",
    );
  });

  it("opens PayByPhone without inventing a zone parameter", () => {
    expect(payHref({ vendor: "paybyphone", code: "" })).toBe(
      "https://www.paybyphone.com/",
    );
  });

  it("percent-encodes anything odd rather than letting it into the URL raw", () => {
    const href = payHref({ vendor: "t2", code: "A B&C", shortCode: "25023" });
    expect(href).toBe("sms:25023?body=A%20B%26C&body=A%20B%26C");
  });

  // The public map renders these as hrefs. payment-link.ts is the allowlist
  // that keeps javascript: out of a popup; every URL we generate must clear it.
  it("only ever produces schemes the payment-link allowlist accepts", () => {
    const all: PayHandoff[] = [
      T2,
      { vendor: "parkmobile", code: "97599515" },
      { vendor: "paybyphone", code: "" },
    ];
    for (const p of all) {
      expect(isAllowedPaymentLink(payHref(p))).toBe(true);
    }
  });
});

describe("payInstruction", () => {
  it("stands alone, because it is what works when the button does not", () => {
    expect(payInstruction(T2)).toBe("Text POKHILL to 25023");
    expect(payInstruction({ vendor: "parkmobile", code: "97599515" })).toBe(
      "ParkMobile zone 97599515",
    );
  });
});

describe("payLabel", () => {
  it("falls back per vendor and honours an override", () => {
    expect(payLabel(T2)).toBe("Pay by text");
    expect(payLabel({ ...T2, label: "  Pay the Port  " })).toBe("Pay the Port");
    expect(payLabel({ ...T2, label: "   " })).toBe("Pay by text");
  });
});

describe("payGroupKey", () => {
  it("collapses the three POKPARK rows into one card", () => {
    const pokpark = parkingZones.filter(
      (z) => z.pay?.[0]?.vendor === "t2" && z.pay[0].code === "POKPARK",
    );
    expect(pokpark.length).toBeGreaterThan(1);
    const keys = new Set(pokpark.map((z) => payGroupKey(z.pay!)));
    expect(keys.size).toBe(1);
  });

  it("keeps different codes apart", () => {
    expect(payGroupKey([T2])).not.toBe(
      payGroupKey([{ ...T2, code: "POKTT" }]),
    );
  });
});

describe("the seed", () => {
  it("gives every Port pay zone the 25023 short code and a keyword", () => {
    const t2 = parkingZones.flatMap((z) => z.pay ?? []).filter((p) => p.vendor === "t2");
    expect(t2.length).toBeGreaterThanOrEqual(5);
    for (const p of t2) {
      expect(p.shortCode).toBe("25023");
      expect(p.code).toMatch(/^POK[A-Z]+$/);
    }
  });

  // A "Pay now" button on a free lot is worse than no button: it tells a
  // visitor they owe money for a space the Port gives away.
  it("attaches no hand-off to free, permit, prohibited or park & ride zones", () => {
    const wrong = parkingZones.filter(
      (z) =>
        z.pay?.length &&
        ["free-2hr", "free-unrestricted", "permit", "prohibited", "park-and-ride-24h", "load-zone"].includes(
          z.rule,
        ),
    );
    expect(wrong.map((z) => z.id)).toEqual([]);
  });
});
