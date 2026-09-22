// Read-only client for the Zeffy public API (https://www.zeffy.com/api/docs).
//
// The API key is WRITE-capable (Zeffy issues no read-only keys) — it can
// create and delete contacts and payments in the Chamber's account. This
// module is server-only, the key is read from the environment at call time,
// and it never appears in a log, an error message, or a stored report.
//
// Responses are validated with zod before anything downstream sees them: the
// provider is a trust boundary, not a colleague.

import "server-only";

import { z } from "zod";

const BASE_URL = "https://api.zeffy.com/api/v1";
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

const answerSchema = z.object({
  question: z.string(),
  type: z.string(),
  answer: z.union([z.string(), z.array(z.string()), z.boolean()]).nullable().optional(),
});
export type ZeffyQuestionAnswer = z.infer<typeof answerSchema>;

const itemSchema = z.object({
  id: z.string(),
  type: z.string(),
  rate_id: z.string().nullable().optional(),
  rate_title: z.string().nullable().optional(),
  contact_id: z.string().nullable().optional(),
  questions: z.array(answerSchema).nullable().optional(),
});
export type ZeffyItem = z.infer<typeof itemSchema>;

const buyerSchema = z.object({
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

const paymentSchema = z.object({
  id: z.string(),
  campaign_id: z.string(),
  status: z.string(),
  refund_status: z.enum(["none", "partial", "full"]).catch("none"),
  /** Unix seconds. */
  created: z.number(),
  buyer: buyerSchema.nullable().optional(),
  buyer_questions: z.array(answerSchema).nullable().optional(),
  items: z.array(itemSchema),
});
export type ZeffyPayment = z.infer<typeof paymentSchema>;

const paymentListSchema = z.object({
  data: z.array(paymentSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});

const contactSchema = z.object({
  id: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type ZeffyContact = z.infer<typeof contactSchema>;

export interface ZeffyConfig {
  apiKey: string;
  campaignId: string;
}

/** Null until both env vars are set — callers report "not configured". */
export function zeffyConfig(env: NodeJS.ProcessEnv = process.env): ZeffyConfig | null {
  const apiKey = env.ZEFFY_API_KEY?.trim();
  const campaignId = env.ZEFFY_CAMPAIGN_ID?.trim();
  if (!apiKey || !campaignId) return null;
  return { apiKey, campaignId };
}

export class ZeffyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ZeffyApiError";
  }
}

export interface ZeffyClient {
  /** Every succeeded payment on the campaign, all pages. */
  listSucceededPayments(campaignId: string): Promise<ZeffyPayment[]>;
  /** Null on 404 — Zeffy's "this payment was deleted". */
  getPayment(id: string): Promise<ZeffyPayment | null>;
  getContact(id: string): Promise<ZeffyContact | null>;
}

type FetchLike = typeof fetch;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createZeffyClient(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  sleepImpl: (ms: number) => Promise<void> = sleep,
): ZeffyClient {
  async function get(path: string, params?: Record<string, string>): Promise<unknown | null> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 404) return null;
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleepImpl((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1) * 1000);
        continue;
      }
      if (!res.ok) {
        // The body is deliberately not surfaced: it could echo the request.
        throw new ZeffyApiError(`Zeffy ${path} answered ${res.status}`, res.status);
      }
      return res.json();
    }
  }

  return {
    async listSucceededPayments(campaignId) {
      const all: ZeffyPayment[] = [];
      let cursor: string | null | undefined;
      for (;;) {
        const raw = await get("/payments", {
          campaign: campaignId,
          status: "succeeded",
          limit: String(PAGE_SIZE),
          ...(cursor ? { starting_after: cursor } : {}),
        });
        const page = paymentListSchema.parse(raw);
        all.push(...page.data);
        if (!page.has_more || !page.next_cursor) return all;
        cursor = page.next_cursor;
      }
    },
    async getPayment(id) {
      const raw = await get(`/payments/${encodeURIComponent(id)}`);
      return raw === null ? null : paymentSchema.parse(raw);
    },
    async getContact(id) {
      const raw = await get(`/contacts/${encodeURIComponent(id)}`);
      return raw === null ? null : contactSchema.parse(raw);
    },
  };
}
