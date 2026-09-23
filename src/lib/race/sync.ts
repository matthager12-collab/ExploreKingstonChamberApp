// Zeffy → race_registrant sync. One ticket item = one registrant row, keyed
// on (payment id, item id), so every run is a full idempotent resync: the
// webhook, the admin "Sync now" button and a replayed delivery all do the
// same thing and converge on the same rows.
//
// Contacts are fetched only for tickets the store has not seen — a re-sync of
// a sold-out race is ~2 requests, well inside Zeffy's 100/min.
//
// Runner data kept (owner's ruling, 2026-09-16): name, email, ticket type,
// the mapped shirt answer, the mapped waiver answer. EVERY other custom
// answer is dropped here — that is how "no emergency contact in the app" is
// enforced, not by hoping the form never asks.

import { race } from "@/lib/data/race";
import {
  cancelRegistrantsForPayment,
  deleteRegistrantsForItems,
  listExistingRegistrants,
  recordRaceSyncRun,
  upsertRegistrants,
  type ExistingRegistrant,
  type RegistrantInput,
} from "@/lib/db/race-registrants";

import {
  createZeffyClient,
  zeffyConfig,
  type ZeffyClient,
  type ZeffyPayment,
  type ZeffyQuestionAnswer,
} from "./zeffy-client";

export const SYNC_ACTOR = "sync:zeffy";
/** A group purchase fires several webhook events within a second; each would
 *  otherwise be a full resync. ponytail: one debounce window, single instance. */
const WEBHOOK_DEBOUNCE_MS = 30_000;

export interface QuestionMap {
  shirt: string | null;
  waiver: string | null;
}

export interface MappedAnswers {
  shirtNote: string | null;
  waiverSigned: boolean | null;
}

/** Case, runs of whitespace and curly quotes are ignored; nothing else. */
const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Pure: pick the two answers the roster keeps, by their WHOLE question
 *  text. Everything else in `answers` is ignored and never leaves this
 *  function. Until 2026-09-22 this matched by prefix, so a question that
 *  merely began with the shirt question's words — "…, and who is your
 *  emergency contact?" — landed in the shirt column that volunteers see. */
export function mapAnswers(
  answers: ZeffyQuestionAnswer[] | null | undefined,
  questions: QuestionMap,
): MappedAnswers {
  let shirtNote: string | null = null;
  let waiverSigned: boolean | null = null;
  for (const a of answers ?? []) {
    const q = norm(a.question);
    if (questions.shirt && q === norm(questions.shirt)) {
      shirtNote = answerText(a.answer);
    } else if (questions.waiver && q === norm(questions.waiver)) {
      waiverSigned = answerBool(a.answer);
    }
  }
  return { shirtNote, waiverSigned };
}

function answerText(answer: ZeffyQuestionAnswer["answer"]): string | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "boolean") return answer ? "yes" : "no";
  const text = (Array.isArray(answer) ? answer.join(", ") : answer).trim();
  return text.length > 0 ? text.slice(0, 200) : null;
}

function answerBool(answer: ZeffyQuestionAnswer["answer"]): boolean | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "boolean") return answer;
  const text = Array.isArray(answer) ? answer.join(" ") : answer;
  return /^(yes|true|agree|i agree|accepted?)\b/i.test(text.trim());
}

export interface RaceSyncStats extends Record<string, number> {
  fetched: number;
  tickets: number;
  created: number;
  cancelled: number;
  needsReview: number;
  contactsFetched: number;
  /** Add-on items (shirts) seen — counted on their order, never runners. */
  addOns: number;
  /** Add-on rows an earlier sync had wrongly stored as runners, now deleted. */
  removed: number;
}

/** "Order: 2 × ExploreKingston exclusive t-shirt" — the order's add-ons.
 *  Prefixed "Order:" because a family order copies it to every runner on
 *  it; it is the order's total, not each runner's. */
function addOnSummary(items: ZeffyPayment["items"], addOnRateIds: ReadonlySet<string>): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.type !== "ticket" || !item.rate_id || !addOnRateIds.has(item.rate_id)) continue;
    const title = item.rate_title?.trim() || "Add-on";
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return `Order: ${[...counts].map(([title, n]) => `${n} × ${title}`).join(", ")}`;
}

export type RaceSyncResult =
  | { ok: true; stats: RaceSyncStats; runId: string }
  | { ok: false; reason: "not-configured" | "debounced" };

export interface RaceSyncDeps {
  client?: ZeffyClient;
  config?: { apiKey: string; campaignId: string } | null;
  questions?: QuestionMap;
  now?: () => number;
  /** Who pressed the button; "webhook" for deliveries. */
  runBy?: string;
}

/** Pure planning step: turn Zeffy payments into registrant inputs, fetching
 *  contacts only for unseen tickets. Exported for tests. */
export async function planRegistrants(
  payments: ZeffyPayment[],
  existing: ExistingRegistrant[],
  campaignId: string,
  client: Pick<ZeffyClient, "getContact">,
  questions: QuestionMap,
  /** Rates Zeffy marks is_add_on (the shirt). Their items arrive typed
   *  "ticket" like any runner's; they are counted on the order instead. */
  addOnRateIds: ReadonlySet<string> = new Set(),
): Promise<{
  inputs: RegistrantInput[];
  contactsFetched: number;
  addOnItems: { paymentId: string; itemId: string }[];
}> {
  const known = new Map(existing.map((r) => [`${r.paymentId}:${r.itemId}`, r]));
  const contactCache = new Map<string, Awaited<ReturnType<ZeffyClient["getContact"]>>>();
  let contactsFetched = 0;
  const inputs: RegistrantInput[] = [];
  const addOnItems: { paymentId: string; itemId: string }[] = [];

  for (const payment of payments) {
    if (payment.campaign_id !== campaignId) continue;
    const buyerAnswers = mapAnswers(payment.buyer_questions, questions);
    const orderAddOns = addOnSummary(payment.items, addOnRateIds);
    const status = payment.refund_status === "full" ? "cancelled" : "active";
    const paymentReview = payment.refund_status === "partial" ? "partial-refund" : null;
    let guestIndex = 0;

    for (const item of payment.items) {
      if (item.type !== "ticket") continue;
      if (item.rate_id && addOnRateIds.has(item.rate_id)) {
        addOnItems.push({ paymentId: payment.id, itemId: item.id });
        continue;
      }
      const key = `${payment.id}:${item.id}`;
      const itemAnswers = mapAnswers(item.questions, questions);
      const sizing = itemAnswers.shirtNote ?? buyerAnswers.shirtNote;
      const base = {
        paymentId: payment.id,
        itemId: item.id,
        rateTitle: item.rate_title?.trim() || "Ticket",
        shirtNote: [orderAddOns, sizing].filter(Boolean).join(" · ") || null,
        waiverSigned: itemAnswers.waiverSigned ?? buyerAnswers.waiverSigned,
        status: status as RegistrantInput["status"],
        registeredAt: new Date(payment.created * 1000),
      };

      const seen = known.get(key);
      if (seen) {
        // Names/email are snapshot-only; the store ignores them on conflict.
        inputs.push({
          ...base,
          contactId: item.contact_id ?? seen.contactId,
          firstName: null,
          lastName: null,
          email: null,
          needsReviewReason: paymentReview ?? (seen.contactId || item.contact_id ? null : "no-contact-id"),
        });
        continue;
      }

      if (item.contact_id) {
        let contact = contactCache.get(item.contact_id);
        if (contact === undefined) {
          contact = await client.getContact(item.contact_id);
          contactsFetched++;
          contactCache.set(item.contact_id, contact);
        }
        inputs.push({
          ...base,
          contactId: item.contact_id,
          firstName: contact?.first_name?.trim() || payment.buyer?.first_name?.trim() || null,
          lastName: contact?.last_name?.trim() || payment.buyer?.last_name?.trim() || null,
          email: contact?.email?.trim() || payment.buyer?.email?.trim() || null,
          needsReviewReason: paymentReview,
        });
        continue;
      }

      // The form did not ask who this ticket is for: attribute it to the buyer
      // and flag it, so packet pickup knows to ask.
      guestIndex++;
      const suffix = guestIndex > 1 ? ` (guest ${guestIndex})` : "";
      inputs.push({
        ...base,
        contactId: null,
        firstName: payment.buyer?.first_name?.trim() || null,
        lastName: `${payment.buyer?.last_name?.trim() || "Unknown"}${suffix}`,
        email: payment.buyer?.email?.trim() || null,
        needsReviewReason: paymentReview ?? "no-contact-id",
      });
    }
  }
  return { inputs, contactsFetched, addOnItems };
}

let inFlight: Promise<RaceSyncResult> | null = null;
let lastStartedAt = 0;

/** Tests reset the single-instance coalescing state between cases. */
export function __resetRaceSyncForTests(): void {
  inFlight = null;
  lastStartedAt = 0;
}

export async function runRaceSync(
  trigger: "manual" | "webhook",
  deps: RaceSyncDeps = {},
): Promise<RaceSyncResult> {
  const now = deps.now ?? Date.now;
  if (inFlight) return inFlight;
  if (trigger === "webhook" && now() - lastStartedAt < WEBHOOK_DEBOUNCE_MS) {
    return { ok: false, reason: "debounced" };
  }
  const config = deps.config === undefined ? zeffyConfig() : deps.config;
  if (!config) return { ok: false, reason: "not-configured" };
  lastStartedAt = now();
  // ponytail: in-process coalescing serialises overlapping runs on the one
  // Render instance; a pg_advisory_xact_lock is the upgrade if a second
  // instance ever appears. Every write is idempotent regardless.
  inFlight = doSync(trigger, config, deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(
  trigger: "manual" | "webhook",
  config: { apiKey: string; campaignId: string },
  deps: RaceSyncDeps,
): Promise<RaceSyncResult> {
  const startedAt = new Date();
  const client = deps.client ?? createZeffyClient(config.apiKey);
  const questions = deps.questions ?? race.questions;

  const payments = await client.listSucceededPayments(config.campaignId);
  const rates = await client.getCampaignRates(config.campaignId);
  const addOnRateIds = new Set(rates.filter((r) => r.is_add_on === true).map((r) => r.id));
  const existing = await listExistingRegistrants();
  const { inputs, contactsFetched, addOnItems } = await planRegistrants(
    payments,
    existing,
    config.campaignId,
    client,
    questions,
    addOnRateIds,
  );

  // Add-on rows the sync stored as runners before 2026-09-22: delete them.
  // ponytail: only rows whose payment Zeffy still lists are found this way;
  // a phantom on a payment since deleted in Zeffy is cancelled below instead.
  const stored = new Set(existing.map((r) => `${r.paymentId}:${r.itemId}`));
  const removed = await deleteRegistrantsForItems(
    addOnItems.filter((i) => stored.has(`${i.paymentId}:${i.itemId}`)),
    SYNC_ACTOR,
  );

  // Payments the store knows that Zeffy no longer lists as succeeded: ask
  // about each one. 404 = deleted; anything but succeeded = cancel.
  const succeeded = new Set(payments.map((p) => p.id));
  const cancelledPayments = new Set<string>();
  for (const paymentId of new Set(existing.filter((r) => r.status === "active").map((r) => r.paymentId))) {
    if (succeeded.has(paymentId)) continue;
    const current = await client.getPayment(paymentId);
    if (!current || current.status !== "succeeded" || current.refund_status === "full") {
      cancelledPayments.add(paymentId);
    }
  }
  // Fully refunded payments still in the list cancel too — through the same
  // audited path, before the upsert (which then leaves status untouched).
  for (const input of inputs) {
    if (input.status === "cancelled") cancelledPayments.add(input.paymentId);
  }
  let cancelled = 0;
  for (const paymentId of cancelledPayments) {
    cancelled += await cancelRegistrantsForPayment(paymentId, SYNC_ACTOR);
  }

  const { inserted } = await upsertRegistrants(inputs, SYNC_ACTOR);

  const stats: RaceSyncStats = {
    fetched: payments.length,
    tickets: inputs.length,
    created: inserted.length,
    cancelled,
    needsReview: inputs.filter((i) => i.needsReviewReason && i.status === "active").length,
    contactsFetched,
    addOns: addOnItems.length,
    removed,
  };
  const runId = await recordRaceSyncRun({
    runBy: deps.runBy ?? trigger,
    stats,
    // Ids only — never a name or an email.
    report: { trigger, cancelledPayments: [...cancelledPayments] },
    startedAt,
  });
  return { ok: true, stats, runId };
}
