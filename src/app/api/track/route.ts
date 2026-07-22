// POST /api/track — anonymous, cookie-less visit counting for LTAC reporting.
//
// The client (src/components/tracker.tsx) sends events via
// navigator.sendBeacon, which posts JSON with a text/plain content type — so
// we always read the raw text and parse it ourselves instead of relying on
// request.json().
//
// Geography is derived server-side from connection headers only — coarse
// country/region/city, no permission prompt, and the IP itself is NEVER
// stored (it is inspected once, below, purely to tell "local dev" from
// "unknown"). Note: IP geolocation cannot reliably produce zip codes; the
// anonymous survey (/api/survey) remains the only zip source.
//
// "geo-ping" events are the one exception where device coordinates arrive at
// all, and only because the visitor tapped a location feature ("what's open
// near me") and accepted the browser's permission prompt. Privacy invariants,
// enforced HERE regardless of what the client sends (E11 — the table-driven
// ingest suite in src/app/api/__tests__/track-route.test.ts is the permanent
// regression net for every one of these):
//   - coordinates are validated to Kitsap-ish bounds, else dropped silently;
//   - they are rounded and classified into a named area server-side, then
//     DISCARDED — only the area bucket is ever stored, never a coordinate;
//   - outbound taps to food/health-assistance destinations and events on
//     sensitive in-app paths are dropped entirely (never-track, not
//     track-less: no count-only fallback) — src/lib/privacy/policy.ts;
//   - "consent" events record only the notice version granted, no location.
//
// This endpoint always answers { ok: true } — telemetry must never break or
// slow down a visitor's session.

import { NextRequest } from "next/server";
import {
  classifyArea,
  roundCoord,
  saveEvent,
  WEB_VITAL_METRICS,
  type AnalyticsEvent,
  type AnalyticsGeo,
  type WebVitalMetric,
} from "@/lib/analytics-store";
import { lookupGeo } from "@/lib/geoip";
import { isSensitiveOutbound, isSensitivePath } from "@/lib/privacy/policy";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

const MAX_PATH = 200;
const MAX_SESSION_ID = 64;
const MAX_HREF = 500;
const MAX_LABEL = 120;
const MAX_GEO_FIELD = 80;
const MAX_NOTICE_VERSION = 16;
const MAX_BODY_BYTES = 8_192;

/**
 * Upper bound per web vital, above which a sample is discarded as junk rather
 * than clamped. Clamping would silently invent a plausible-looking value at
 * the ceiling and drag the p75 with it; dropping loses one row and keeps the
 * distribution honest. 300_000ms is 5 minutes — a page load beyond that is a
 * device asleep mid-load or a forged beacon, not a visitor experience worth
 * reporting. CLS is a ratio that realistically never exceeds single digits.
 */
const MAX_VITAL_VALUE: Record<WebVitalMetric, number> = {
  LCP: 300_000,
  INP: 300_000,
  CLS: 100,
};

// Kitsap-ish bounding box for geo-pings. Anything outside is dropped
// silently — the feature is about movement around Kingston, and out-of-range
// coordinates are either GPS glitches or someone poking at the API.
const GEO_MIN_LAT = 47.5;
const GEO_MAX_LAT = 48.1;
const GEO_MIN_LNG = -123.0;
const GEO_MAX_LNG = -122.2;

function trunc(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

/** Loopback / RFC-1918 / link-local check — used only to label dev traffic. */
function isLoopbackOrPrivate(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, "").toLowerCase();
  if (v === "::1" || v === "localhost") return true;
  if (/^127\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true; // link-local
  if (/^f[cd]/.test(v) || /^fe80/.test(v)) return true; // IPv6 ULA / link-local
  return false;
}

function deriveGeo(request: NextRequest): AnalyticsGeo {
  // On Vercel, the platform injects coarse IP-derived geography headers.
  const country = request.headers.get("x-vercel-ip-country");
  if (country) {
    const rawCity = request.headers.get("x-vercel-ip-city");
    let city: string | undefined;
    if (rawCity) {
      try {
        city = decodeURIComponent(rawCity); // header is URL-encoded, e.g. "S%C3%A9attle"
      } catch {
        city = rawCity;
      }
    }
    return {
      country: trunc(country, MAX_GEO_FIELD),
      region: trunc(request.headers.get("x-vercel-ip-country-region"), MAX_GEO_FIELD),
      city: trunc(city, MAX_GEO_FIELD),
      source: "vercel-headers",
    };
  }

  // No platform geo headers (the self-hosted / Render case). Peek at the
  // connection IP to classify local dev traffic and, for a public IP, to look up
  // coarse geography in the local GeoLite2 database. The IP is inspected in
  // memory and NEVER stored or logged — only the coarse country/region/city
  // strings returned below persist.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = (forwarded?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "").trim();
  if (ip && isLoopbackOrPrivate(ip)) {
    return { source: "dev-local" };
  }
  if (ip) {
    const hit = lookupGeo(ip);
    if (hit) {
      return {
        country: trunc(hit.country, MAX_GEO_FIELD),
        region: trunc(hit.region, MAX_GEO_FIELD),
        city: trunc(hit.city, MAX_GEO_FIELD),
        source: "geolite2",
      };
    }
  }
  return { source: "unknown" };
}

export async function POST(request: NextRequest) {
  try {
    // sendBeacon delivers JSON as text/plain; fetch fallback sends it as
    // application/json — reading raw text handles both.
    const raw = await request.text();
    // Abuse controls below are silent drops, never an error status: telemetry
    // must never break or signal to a visitor (see file header).
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ ok: true });
    }
    const limit = await checkRateLimit(clientKey(request, "track"), {
      limit: 120,
      windowMs: 5 * 60_000,
    });
    if (!limit.ok) {
      return Response.json({ ok: true });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;

    const type =
      body.type === "outbound"
        ? "outbound"
        : body.type === "pageview"
          ? "pageview"
          : body.type === "geo-ping"
            ? "geo-ping"
            : body.type === "consent"
              ? "consent"
              : body.type === "webvital"
                ? "webvital"
                : null;
    // Geo-ping and consent beacons are payload + session only; default their
    // path so the shared validation below still applies to pageviews/outbound.
    const path =
      trunc(body.path, MAX_PATH) ??
      (type === "geo-ping" || type === "consent" ? "/" : undefined);
    const sessionId = trunc(body.sessionId, MAX_SESSION_ID)?.replace(/[^A-Za-z0-9_-]/g, "");

    // Drop malformed events and anything from the admin dashboard itself
    // (the client tracker already skips /admin; this is defense in depth).
    if (!type || !path || !path.startsWith("/") || !sessionId || path.startsWith("/admin")) {
      return Response.json({ ok: true });
    }

    // E11 privacy floor: events touching food/health-assistance resources are
    // never persisted — not counted, not sampled, nothing. The client mirrors
    // this check (tracker.tsx), but THIS drop is the guarantee.
    if (isSensitivePath(path)) {
      return Response.json({ ok: true });
    }
    const href = type === "outbound" ? trunc(body.href, MAX_HREF) : undefined;
    if (href && isSensitiveOutbound(href)) {
      return Response.json({ ok: true });
    }

    // Geo-pings: validate, then coarsen, then DISCARD. Coordinates must be
    // finite and within Kitsap-ish bounds or the event is dropped silently.
    // Whatever precision the client sent, we round to 3 decimals and classify
    // the named area server-side — then only the AREA BUCKET is stored; the
    // rounded coordinates exist transiently in this block and nowhere else
    // (E11: no lat/lng key ever reaches the store).
    let geoPing: Pick<AnalyticsEvent, "area"> | undefined;
    if (type === "geo-ping") {
      const lat = typeof body.lat === "number" ? body.lat : Number(body.lat);
      const lng = typeof body.lng === "number" ? body.lng : Number(body.lng);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < GEO_MIN_LAT ||
        lat > GEO_MAX_LAT ||
        lng < GEO_MIN_LNG ||
        lng > GEO_MAX_LNG
      ) {
        return Response.json({ ok: true });
      }
      geoPing = { area: classifyArea(roundCoord(lat), roundCoord(lng)) };
    }

    // Web vitals: a browser timing about the PAGE, never about the visitor —
    // no coordinate, no identifier, nothing read from the device (see the
    // AnalyticsEvent.metric doc comment for why this needs no geo consent).
    // Validated here rather than trusted, because this endpoint is public: an
    // unbounded client-supplied number would let anyone poison the p75 the
    // Chamber reads, and NaN/Infinity would corrupt every percentile after it.
    let webVital: Pick<AnalyticsEvent, "metric" | "value"> | undefined;
    if (type === "webvital") {
      const metric = WEB_VITAL_METRICS.find((m) => m === body.metric);
      const raw = typeof body.value === "number" ? body.value : Number(body.value);
      if (!metric || !Number.isFinite(raw) || raw < 0 || raw > MAX_VITAL_VALUE[metric]) {
        return Response.json({ ok: true });
      }
      // CLS is a small unitless score, so it keeps 3 decimals; LCP/INP are
      // milliseconds, where sub-millisecond precision is noise.
      const value = metric === "CLS" ? Math.round(raw * 1000) / 1000 : Math.round(raw);
      webVital = { metric, value };
    }

    // E22: which client sent this. Whitelisted to the ONE literal we accept,
    // exactly like every other field here — this endpoint is public, so an
    // arbitrary client-supplied string would let anyone invent a series, and a
    // free-text field is a free-text field even when we only meant to write
    // "kiosk" into it. Absent (the website) stays absent, which is what keeps
    // every event written before the kiosk existed counting as a visitor.
    const source = body.source === "kiosk" ? ("kiosk" as const) : undefined;

    const event: AnalyticsEvent = {
      ts: new Date().toISOString(),
      type,
      path,
      sessionId,
      geo: deriveGeo(request),
      ...(source ? { source } : {}),
      ...(type === "outbound" ? { href, label: trunc(body.label, MAX_LABEL) } : {}),
      ...(type === "consent"
        ? {
            noticeVersion: trunc(body.noticeVersion, MAX_NOTICE_VERSION),
            consentPurpose: trunc(body.purpose, MAX_NOTICE_VERSION),
          }
        : {}),
      ...(geoPing ?? {}),
      ...(webVital ?? {}),
    };

    await saveEvent(event);
  } catch {
    // Bad JSON, read-only filesystem, whatever — never fail the visitor.
  }
  return Response.json({ ok: true });
}
