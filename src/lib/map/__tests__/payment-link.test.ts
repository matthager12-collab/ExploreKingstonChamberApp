import { describe, expect, it } from "vitest";
import { isAllowedPaymentLink } from "@/lib/map/payment-link";

describe("isAllowedPaymentLink", () => {
  const allowed = [
    "https://app.parkmobile.io/zone/start?internalZoneCode=1",
    "sms:25023?body=POKPARK",
    "tel:+13601234567",
  ];
  const rejected = [
    "javascript://%0aalert(1)",
    "data:text/html,x",
    "http://insecure.example",
    "paybyphone://pay",
    "",
    "https://example.com/" + "a".repeat(500),
  ];

  it.each(allowed)("allows %s", (value) => {
    expect(isAllowedPaymentLink(value)).toBe(true);
  });

  it.each(rejected)("rejects %s", (value) => {
    expect(isAllowedPaymentLink(value)).toBe(false);
  });
});
