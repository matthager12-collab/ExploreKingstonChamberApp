// Polite-ingestion HTTP layer shared by the two adapters (E12). This module
// and the adapters are the I/O EDGE of the events subsystem — everything they
// hand onward is plain data into the pure core.
//
// Politeness rules (epic constraints — the app is fetching the Chamber's own
// sites): sequential requests with >= 300 ms spacing, 15 s timeout, a
// self-identifying User-Agent, GET only (the helper hardcodes the method).
//
// The allowlist is enforced HERE, on every request, including derived URLs
// and post-redirect landing hosts: no fetch leaves SOURCE_ALLOWLIST, ever
// (charter "Never"; unit-tested).

import { SOURCE_ALLOWLIST } from "./types";

export const INGEST_USER_AGENT =
  "visit-kingston-events-ingest/1.0 (Greater Kingston Chamber tourism app)";
export const REQUEST_SPACING_MS = 300;
export const REQUEST_TIMEOUT_MS = 15_000;

export class AllowlistError extends Error {
  constructor(url: string) {
    super(`refusing to fetch ${url}: host is not in SOURCE_ALLOWLIST`);
    this.name = "AllowlistError";
  }
}

/** Throws AllowlistError unless the URL's host is exactly one of the three
 *  allowlisted hosts. A misconfigured source is a programmer/config error and
 *  fails LOUD; network conditions fail soft elsewhere. */
export function assertAllowlisted(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new AllowlistError(url);
  }
  if (!(SOURCE_ALLOWLIST as readonly string[]).includes(host)) {
    throw new AllowlistError(url);
  }
}

export interface PoliteResponse {
  status: number;
  contentType: string;
  body: string;
  /** Network-level failure (timeout, DNS, refused) — status is 0. */
  error?: string;
}

export interface PoliteFetchDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to REQUEST_SPACING_MS. */
  spacingMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sequential polite GET factory: each returned function shares one "last
 *  request" clock so spacing holds across both adapters in one ingest run. */
export function createPoliteGet(deps?: PoliteFetchDeps) {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const spacingMs = deps?.spacingMs ?? REQUEST_SPACING_MS;
  let first = true;

  return async function politeGet(url: string): Promise<PoliteResponse> {
    assertAllowlisted(url);
    if (!first && spacingMs > 0) await sleep(spacingMs);
    first = false;
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { "User-Agent": INGEST_USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "follow",
      });
      // A redirect chain may not leave the allowlist either (a dead subdomain
      // parked onto an ad host must read as a rejection, not as data).
      if (res.url) assertAllowlisted(res.url);
      const body = await res.text();
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body,
      };
    } catch (err) {
      if (err instanceof AllowlistError) throw err;
      return {
        status: 0,
        contentType: "",
        body: "",
        error: String((err as Error)?.message ?? err),
      };
    }
  };
}

/** The truth triple (charter "Always"): HTTP status AND content-type AND body
 *  prefix — the ChamberMaster soft-404 (200 + text/html + "Event is not
 *  found.") is why status-only checks lie. */
export function truthTriple(
  res: PoliteResponse,
  expectedContentType: string,
  expectedBodyPrefix: string,
): string | null {
  if (res.error) return `request failed: ${res.error}`;
  if (res.status !== 200) return `HTTP ${res.status}`;
  if (!res.contentType.toLowerCase().includes(expectedContentType)) {
    return `content-type ${res.contentType || "(none)"} is not ${expectedContentType}`;
  }
  const body = res.body.replace(/^﻿/, "");
  if (!body.startsWith(expectedBodyPrefix)) {
    return `body does not start with ${expectedBodyPrefix} (soft-404 or wrong document)`;
  }
  return null;
}
