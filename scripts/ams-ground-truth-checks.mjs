#!/usr/bin/env node
// ams-ground-truth-checks.mjs — re-verifies the machine-checkable facts behind
// docs/adr/ADR-0001-ams-ground-truth.md (E04 + 2026-07-10 correction). Zero
// dependencies: node:dns/promises + global fetch (Node >= 20). GET-only by
// construction — the single `get` helper below hardcodes the method; there is
// no other request path in this file.
//
// Doubles as the tenant-drift alarm. The load-bearing invariant (ADR-0001
// Correction) is TENANT PARITY: business.kingstonchamber.com and the staff
// tenant at greaterkingstoncommunitychamberofcommerce.growthzoneapp.com embed
// the same GrowthZone TenantId (3508) — one tenant, two hostnames. The DNS
// CNAME (public.west.us.memberzone.org) and the ChamberMaster PRODID are
// legacy naming on GrowthZone's shared public-modules infra and do NOT
// discriminate the platform; they are recorded as INFO only.
//
// Usage: npm run ams:checks   (add --json to also dump the JSON snapshot to stdout)
// Writes: docs/adr/ams-ground-truth-checks.json
// Exit 0 iff all REQUIRED checks pass.

import { resolveCname } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const HOST = "business.kingstonchamber.com";
const BASE = `https://${HOST}`;
const STAFF_TENANT_HOST =
  "greaterkingstoncommunitychamberofcommerce.growthzoneapp.com";
const EXPECTED_TENANT_ID = "3508";
const USER_AGENT =
  "visit-kingston-ground-truth-check/1.0 (Greater Kingston Chamber tourism app)";
const REQUEST_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "adr",
  "ams-ground-truth-checks.json",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let firstRequest = true;
// The one and only HTTP helper. Read-only against the outside world: the method
// is the hardcoded literal below, requests run sequentially, and callers get a
// uniform shape even on network failure (status 0 + error message).
async function get(url) {
  if (!firstRequest) await sleep(REQUEST_DELAY_MS);
  firstRequest = false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "follow",
    });
    const body = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
  } catch (err) {
    return { status: 0, contentType: "", body: "", error: String(err?.message ?? err) };
  }
}

// Strip a UTF-8 BOM so "starts with" checks test the real first characters.
const bodyPrefix = (body) => body.replace(/^﻿/, "");

// Levels: REQUIRED entries gate the exit code; PROBE entries are per-item
// results feeding a REQUIRED aggregate (spec: >= 1 per-event feed must pass,
// so one dead event must not fail the gate); INFO entries are record-only.
const results = [];
function record(level, name, ok, detail) {
  results.push({ level, name, ok, detail });
  const tag =
    level === "INFO" ? "INFO " : ok ? "PASS " : "fail ";
  console.log(`[${tag}] ${level.padEnd(8)} ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// INFO — DNS CNAME. Record-only: memberzone.org is GrowthZone's shared
// public-modules hosting and does NOT identify the product (ADR-0001
// Correction, 2026-07-10 — the original E04 run treated this as platform
// proof and was wrong). A changed CNAME is worth noting, not failing.
// ---------------------------------------------------------------------------
let dnsCname = "";
{
  let names = [];
  let dnsError = "";
  try {
    names = await resolveCname(HOST);
  } catch (err) {
    dnsError = String(err?.message ?? err);
  }
  // resolveCname returns names without the trailing dot dig shows.
  const normalized = names.map((n) => n.replace(/\.$/, ""));
  dnsCname = normalized[0] ?? "";
  const isKnownInfra = dnsCname === "public.west.us.memberzone.org";
  record(
    "INFO",
    `DNS CNAME ${HOST}`,
    true,
    dnsError
      ? `lookup failed: ${dnsError}`
      : `${normalized.join(", ") || "(no CNAME)"}${
          isKnownInfra
            ? " (GrowthZone shared public-modules infra; legacy naming, not platform proof)"
            : " — CHANGED from public.west.us.memberzone.org; hosting infra moved, note it in ADR-0001"
        }`,
  );
}

// ---------------------------------------------------------------------------
// REQUIRED — events index yields Details slugs.
// Trap (verified 2026-07-05): do NOT discover iCal links by grepping the index
// for "ical" — event titles containing "classical" match. Derive the .ics URLs
// from the Details slugs instead.
// ---------------------------------------------------------------------------
const eventsIndexUrl = `${BASE}/events`;
let slugs = [];
let eventsIndex;
let customDomainTenantId = null;
{
  const res = await get(eventsIndexUrl);
  const found = new Set();
  for (const m of res.body.matchAll(/events\/Details\/([A-Za-z0-9-]+-\d+)/g)) {
    found.add(m[1]);
    if (found.size >= 3) break;
  }
  slugs = [...found];
  // GrowthZone public-modules pages embed `<!-- TenantId: N; ... -->`.
  customDomainTenantId = res.body.match(/\bTenantId:\s*(\d+)/)?.[1] ?? null;
  const ok = res.status === 200 && slugs.length >= 1;
  eventsIndex = {
    url: eventsIndexUrl,
    status: res.status,
    contentType: res.contentType,
    detailsSlugsFound: slugs,
    pass: ok,
    ...(res.error ? { error: res.error } : {}),
  };
  record(
    "REQUIRED",
    "events index",
    ok,
    res.error
      ? `request failed: ${res.error}`
      : `HTTP ${res.status}; ${slugs.length} Details slug(s): ${slugs.join(", ") || "none"}`,
  );
}

// ---------------------------------------------------------------------------
// REQUIRED — tenant parity: the load-bearing invariant. The custom-domain
// public site and the staff tenant on growthzoneapp.com must embed the same
// GrowthZone TenantId (one tenant, two hostnames). If this breaks — either
// hostname stops serving TenantId 3508 — the Chamber's setup changed and
// ADR-0001 plus the E16 sync design are stale.
// ---------------------------------------------------------------------------
let tenantParity;
{
  const staffUrl = `https://${STAFF_TENANT_HOST}/events`;
  const res = await get(staffUrl);
  const staffTenantId = res.body.match(/\bTenantId:\s*(\d+)/)?.[1] ?? null;
  const match =
    customDomainTenantId !== null &&
    staffTenantId !== null &&
    customDomainTenantId === staffTenantId;
  const asExpected = match && customDomainTenantId === EXPECTED_TENANT_ID;
  if (!asExpected) {
    // Only claim drift when both pages were actually fetched and parsed; a
    // transient fetch failure is not evidence the tenant changed.
    if (customDomainTenantId !== null && staffTenantId !== null) {
      console.error(
        "TENANT CHANGED — the two hostnames no longer serve GrowthZone tenant " +
          `${EXPECTED_TENANT_ID} (custom domain: ${customDomainTenantId}, ` +
          `staff host: ${staffTenantId}); ADR-0001 and the E16 design assumptions are stale`,
      );
    } else {
      console.error(
        "PARITY UNVERIFIABLE — could not extract a TenantId from " +
          `${customDomainTenantId === null ? HOST : STAFF_TENANT_HOST} ` +
          "(fetch failed or page markup changed); rerun before concluding drift",
      );
    }
  }
  tenantParity = {
    customDomainHost: HOST,
    staffTenantHost: STAFF_TENANT_HOST,
    customDomainTenantId,
    staffTenantId,
    expectedTenantId: EXPECTED_TENANT_ID,
    match,
    asExpected,
    ...(res.error ? { error: res.error } : {}),
  };
  record(
    "REQUIRED",
    "tenant parity (one tenant, two hostnames)",
    asExpected,
    res.error
      ? `staff-host request failed: ${res.error}`
      : `custom domain TenantId=${customDomainTenantId ?? "none"}, staff host TenantId=${staffTenantId ?? "none"} (expected ${EXPECTED_TENANT_ID})`,
  );
}

// ---------------------------------------------------------------------------
// REQUIRED — per-event iCal. Truth triple on every probe: status + content-type
// + body prefix (the /events/ical soft-404 below is why status alone lies here).
// ---------------------------------------------------------------------------
const perEventIcs = [];
{
  for (const slug of slugs) {
    const url = `${BASE}/events/ICal/${slug}.ics`;
    const res = await get(url);
    const body = bodyPrefix(res.body);
    const pass =
      res.status === 200 &&
      res.contentType.startsWith("text/calendar") &&
      body.startsWith("BEGIN:VCALENDAR") &&
      body.includes("BEGIN:VEVENT");
    const prodId = body.match(/^PRODID:(.*)$/m)?.[1]?.trim() ?? null;
    const hasLosAngelesTzid = body.includes("TZID:America/Los_Angeles");
    const publishedTtl = body.match(/^X-PUBLISHED-TTL:(.*)$/m)?.[1]?.trim() ?? null;
    perEventIcs.push({
      url,
      status: res.status,
      contentType: res.contentType,
      pass,
      prodId,
      hasLosAngelesTzid,
      publishedTtl,
      ...(res.error ? { error: res.error } : {}),
    });
    record(
      "PROBE",
      `per-event iCal ${slug}`,
      pass,
      res.error
        ? `request failed: ${res.error}`
        : `HTTP ${res.status}, ${res.contentType || "(no content-type)"}; PRODID=${prodId ?? "(none)"}; TTL=${publishedTtl ?? "(none)"}`,
    );
    if (pass && !hasLosAngelesTzid) {
      console.warn(
        `  WARN: ${slug} — no TZID:America/Los_Angeles in feed (not a failure; check VTIMEZONE handling before ingest)`,
      );
    }
  }
  const anyPass = perEventIcs.some((p) => p.pass);
  record(
    "REQUIRED",
    "per-event iCal (>= 1 of probed events)",
    anyPass,
    `${perEventIcs.filter((p) => p.pass).length}/${perEventIcs.length} probed feeds valid`,
  );
}

// ---------------------------------------------------------------------------
// INFORMATIONAL — calendar-wide feed candidates. Absence is the expected,
// documented answer; a candidate counts as FOUND only on a real feed body.
// /events/ical is the verified soft-404: HTTP 200 + text/html + "Event is not
// found." — recorded, not failed.
// ---------------------------------------------------------------------------
const calendarWideCandidates = [];
{
  for (const p of ["/events/ical", "/events/rss", "/events/icalfeed", "/events/calendar.ics", "/rss"]) {
    const url = `${BASE}${p}`;
    const res = await get(url);
    const body = bodyPrefix(res.body);
    const isCalendar =
      res.contentType.startsWith("text/calendar") && body.startsWith("BEGIN:VCALENDAR");
    const isXmlFeed =
      body.startsWith("<?xml") &&
      /xml|rss|atom/i.test(res.contentType);
    const found = isCalendar || isXmlFeed;
    const softNotFound =
      res.status === 200 &&
      res.contentType.startsWith("text/html") &&
      res.body.includes("Event is not found");
    calendarWideCandidates.push({
      url,
      status: res.status,
      contentType: res.contentType,
      found,
      softNotFound,
      ...(res.error ? { error: res.error } : {}),
    });
    record(
      "INFO",
      `calendar-wide candidate ${p}`,
      true,
      res.error
        ? `request failed: ${res.error}`
        : `HTTP ${res.status}, ${res.contentType || "(no content-type)"} — ${
            found ? "FOUND (a real feed!)" : softNotFound ? "soft-404 (200 + HTML 'Event is not found.')" : "not a feed"
          }`,
    );
  }
  const anyFound = calendarWideCandidates.some((c) => c.found);
  if (anyFound) {
    console.warn(
      "  NOTE: a calendar-wide feed now EXISTS — ADR-0001 and the E12 ingest plan should be updated to use it.",
    );
  }
}

// ---------------------------------------------------------------------------
// INFORMATIONAL — module probes (record only).
// ---------------------------------------------------------------------------
const modules = {};
{
  for (const [p, expected] of [["/jobs", 200], ["/hotdeals", 404]]) {
    const res = await get(`${BASE}${p}`);
    modules[p] = {
      status: res.status,
      expected,
      matchesExpected: res.status === expected,
      ...(res.error ? { error: res.error } : {}),
    };
    record(
      "INFO",
      `module ${p}`,
      true,
      res.error
        ? `request failed: ${res.error}`
        : `HTTP ${res.status} (expected ${expected}${res.status === expected ? "" : " — CHANGED"})`,
    );
  }
}

// ---------------------------------------------------------------------------
// INFORMATIONAL — CM/MZ API docs reachability. The vendor's own docs cite the
// plain-http URL; try https first, fall back, record which worked. No parsing,
// no auth.
// ---------------------------------------------------------------------------
let apiDocs;
{
  const httpsUrl = "https://api.micronetonline.com/v1/documentation";
  let res = await get(httpsUrl);
  let scheme = "https";
  if (res.status !== 200) {
    const fallback = await get("http://api.micronetonline.com/v1/documentation");
    if (fallback.status === 200) {
      res = fallback;
      scheme = "http";
    }
  }
  apiDocs = {
    url: `${scheme}://api.micronetonline.com/v1/documentation`,
    schemeThatWorked: res.status === 200 ? scheme : null,
    status: res.status,
    contentType: res.contentType,
    ...(res.error ? { error: res.error } : {}),
  };
  record(
    "INFO",
    "CM/MZ API documentation",
    true,
    res.error
      ? `request failed: ${res.error}`
      : `HTTP ${res.status} via ${scheme} (public endpoint reference, no login)`,
  );
}

// ---------------------------------------------------------------------------
// Snapshot + verdict.
// ---------------------------------------------------------------------------
const requiredChecksPass = results
  .filter((r) => r.level === "REQUIRED")
  .every((r) => r.ok);

const snapshot = {
  generatedAt: new Date().toISOString(),
  dnsCname,
  tenantParity,
  eventsIndex,
  perEventIcs,
  calendarWideCandidates,
  modules,
  apiDocs,
  requiredChecksPass,
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`\nSnapshot written: ${path.relative(process.cwd(), OUT_PATH)}`);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(snapshot, null, 2));
}

console.log(`\nREQUIRED CHECKS: ${requiredChecksPass ? "PASS" : "FAIL"}`);
process.exitCode = requiredChecksPass ? 0 : 1;
