// E11: the policy manifest is load-bearing — the purge job executes it and
// /privacy renders it — so its shape and helpers get their own suite.

import { describe, expect, it } from "vitest";

import {
  BELOW_K_BUCKET,
  K_FLOOR,
  PRIVACY_NOTICE_CHANGELOG,
  PRIVACY_NOTICE_VERSION,
  RETENTION_POLICY,
  SENSITIVE_DESTINATIONS,
  isSensitiveOutbound,
  isSensitivePath,
} from "./policy";

describe("sensitive-destination matching", () => {
  it("matches the seeded food-bank host exactly", () => {
    expect(isSensitiveOutbound("https://sharenetfoodbank.org")).toBe(true);
    expect(isSensitiveOutbound("https://sharenetfoodbank.org/whatever?x=1")).toBe(true);
  });

  it("matches subdomains via suffix rule", () => {
    expect(isSensitiveOutbound("https://www.sharenetfoodbank.org/hours")).toBe(true);
    expect(isSensitiveOutbound("http://donate.sharenetfoodbank.org")).toBe(true);
  });

  it("does not match lookalike hosts (no bare substring matching)", () => {
    expect(isSensitiveOutbound("https://notsharenetfoodbank.org")).toBe(false);
    expect(isSensitiveOutbound("https://sharenetfoodbank.org.evil.com")).toBe(false);
  });

  it("is case-insensitive on the hostname", () => {
    expect(isSensitiveOutbound("https://ShareNetFoodBank.ORG/x")).toBe(true);
  });

  it("returns false on unparseable input (upstream caps bound garbage)", () => {
    expect(isSensitiveOutbound("")).toBe(false);
    expect(isSensitiveOutbound("not a url")).toBe(false);
    expect(isSensitiveOutbound("sharenetfoodbank.org/no-protocol")).toBe(false);
  });

  it("sees through mailto: — a food-bank contact email is as identifying as its website", () => {
    expect(isSensitiveOutbound("mailto:info@sharenetfoodbank.org")).toBe(true);
    expect(isSensitiveOutbound("mailto:info@sharenetfoodbank.org?subject=Volunteering")).toBe(true);
    expect(isSensitiveOutbound("mailto:x@mail.sharenetfoodbank.org")).toBe(true);
    expect(isSensitiveOutbound("mailto:a@example.com,b@sharenetfoodbank.org")).toBe(true);
    expect(isSensitiveOutbound("mailto:info@sharenetfoodbank.org.")).toBe(true);
    expect(isSensitiveOutbound("mailto:someone@example.com")).toBe(false);
    expect(isSensitiveOutbound("mailto:no-at-sign")).toBe(false);
    expect(isSensitiveOutbound("tel:+13605551234")).toBe(false);
  });

  it("normalizes the trailing-dot FQDN form (same server, same rule)", () => {
    expect(isSensitiveOutbound("https://sharenetfoodbank.org./food")).toBe(true);
    expect(isSensitiveOutbound("https://www.sharenetfoodbank.org./x")).toBe(true);
  });

  it("seeds sharenetfoodbank.org in SENSITIVE_DESTINATIONS (acceptance criterion 3)", () => {
    expect(SENSITIVE_DESTINATIONS).toContain("sharenetfoodbank.org");
  });
});

describe("sensitive-path matching", () => {
  it("is inert while the live list is empty", () => {
    expect(isSensitivePath("/eat")).toBe(false);
    expect(isSensitivePath("/food-assistance")).toBe(false);
  });

  // The live list is empty by design (mechanism ships ahead of the page), so
  // the prefix semantics are proven against an injected fixture — the same
  // code path a real entry will take.
  it("prefix-matches on segment boundaries when an entry exists", () => {
    const fixture = ["/food-assistance"];
    expect(isSensitivePath("/food-assistance", fixture)).toBe(true);
    expect(isSensitivePath("/food-assistance/hours", fixture)).toBe(true);
    expect(isSensitivePath("/food-assistance-fair", fixture)).toBe(false);
    expect(isSensitivePath("/eat", fixture)).toBe(false);
  });

  it("suffix rule works for injected destination fixtures too", () => {
    const fixture = ["example.org"];
    expect(isSensitiveOutbound("https://a.example.org/x", fixture)).toBe(true);
    expect(isSensitiveOutbound("https://example.com/x", fixture)).toBe(false);
  });
});

describe("retention manifest shape", () => {
  it("covers every store the epic names, exactly once", () => {
    const stores = RETENTION_POLICY.map((r) => r.store);
    expect(new Set(stores).size).toBe(stores.length);
    for (const required of [
      "analytics-geo-pings",
      "analytics-events",
      "survey-responses",

      "audit",
      "ferry-observations",
    ]) {
      expect(stores).toContain(required);
    }
  });

  it("marks the audit table never-purge (the floor)", () => {
    const audit = RETENTION_POLICY.find((r) => r.store === "audit");
    expect(audit?.action).toBe("never-purge");
    expect(audit?.windowDays).toBeUndefined();
    expect(audit?.windowMonths).toBeUndefined();
  });

  it("gives every time-bound rule exactly one window dimension", () => {
    for (const rule of RETENTION_POLICY) {
      const dims = [rule.windowDays, rule.windowMonths].filter((v) => v !== undefined);
      if (rule.action === "rollup-then-delete" || rule.action === "delete") {
        expect(dims, rule.store).toHaveLength(1);
      }
      if (rule.action === "never-purge" || rule.action === "redact-at-resolution") {
        expect(dims, rule.store).toHaveLength(0);
      }
    }
  });

  it("keeps Mat's confirmed numbers (§4-a) — change requires a human decision", () => {
    expect(K_FLOOR).toBe(5);
    const byStore = Object.fromEntries(RETENTION_POLICY.map((r) => [r.store, r]));
    expect(byStore["analytics-geo-pings"].windowDays).toBe(90);
    expect(byStore["analytics-events"].windowMonths).toBe(25);
    expect(byStore["survey-responses"].windowMonths).toBe(36);

  });
});

describe("notice version", () => {
  it("is a YYYY-MM string with a matching changelog head", () => {
    expect(PRIVACY_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}$/);
    expect(PRIVACY_NOTICE_CHANGELOG[0]?.version).toBe(PRIVACY_NOTICE_VERSION);
  });

  it("collapse bucket is not a real area id", () => {
    expect(BELOW_K_BUCKET).toBe("below-threshold");
  });
});
