// Storage for in-app "Give feedback" submissions (the site-wide side tab).
//
// Append-only Postgres log (feedback_response) via the data layer's append
// helpers (src/lib/db/append.ts) — the same posture as survey-store.ts.
//
// The one real difference from the survey store: this one exposes raw rows
// (list()) as well as an aggregate (summarize()). The survey store deliberately
// does NOT, because its numbers are the LTAC report and a raw row there would
// be a timestamped answer nobody needs. Here the free text IS the deliverable —
// a star average with no comments attached tells the Chamber nothing it can act
// on. Both readers are admin-gated at every call site.

import {
  appendFeedbackResponse,
  deleteFeedbackResponseById,
  readFeedbackResponseRows,
  readFeedbackResponses,
} from "./db/append";
import { FEEDBACK_MAX_RATING, FEEDBACK_MIN_RATING, type FeedbackResponse } from "./types";

/** A stored submission plus the surrogate id that addresses it. The id is the
 *  only field that uniquely names one row (see schema.ts) and is what the
 *  admin delete control deletes by. */
export interface FeedbackRow {
  id: number;
  response: FeedbackResponse;
}

/** Aggregate counts for the admin page. */
export interface FeedbackSummary {
  total: number;
  /** Mean rating to one decimal, or null when there is nothing to average —
   *  NOT 0, which would render as a real one-star-ish score on an empty log. */
  averageRating: number | null;
  /** Submissions per star, always with all five keys present (zeros included)
   *  so the distribution bars render a full axis on a sparse log. */
  byRating: Record<number, number>;
  /** Submissions per source path, descending by count. */
  byPath: { path: string; count: number; averageRating: number }[];
  /** How many carried an actual written answer, not just a rating. */
  withComment: number;
}

export interface FeedbackStore {
  save(response: FeedbackResponse): Promise<void>;
  summarize(sinceIso?: string): Promise<FeedbackSummary>;
  /** Newest first. `limit` bounds what the admin page renders in one go — the
   *  log is unbounded between retention runs and this is free text, so an
   *  unbounded read would eventually be a very slow page full of essays. */
  list(sinceIso?: string, limit?: number): Promise<FeedbackResponse[]>;
  /** Same list, carrying the id each row is addressed by. */
  listRows(sinceIso?: string, limit?: number): Promise<FeedbackRow[]>;
  /**
   * Delete one submission by id. Returns true when a row was actually removed —
   * false means it was already gone (a double-click, or the retention purge got
   * there first), which is a different answer to give the person who asked.
   */
  remove(id: number): Promise<boolean>;
}

/** Rows the admin page renders before paging. */
export const FEEDBACK_PAGE_SIZE = 200;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

class DbFeedbackStore implements FeedbackStore {
  async save(response: FeedbackResponse): Promise<void> {
    await appendFeedbackResponse(response);
  }

  async summarize(sinceIso?: string): Promise<FeedbackSummary> {
    const rows = await readFeedbackResponses<FeedbackResponse>(sinceIso);

    const byRating: Record<number, number> = {};
    for (let r = FEEDBACK_MIN_RATING; r <= FEEDBACK_MAX_RATING; r++) byRating[r] = 0;

    const perPath = new Map<string, { count: number; sum: number }>();
    let sum = 0;
    let withComment = 0;

    for (const row of rows) {
      // Defensive: a row is whatever was in the JSONB column, which includes
      // anything a past version of the route wrote. A rating outside the range
      // would skew the average and blow a hole in the distribution, so it is
      // counted in `total` (it happened) but excluded from both.
      const rated =
        Number.isFinite(row.rating) &&
        row.rating >= FEEDBACK_MIN_RATING &&
        row.rating <= FEEDBACK_MAX_RATING;
      if (rated) {
        byRating[row.rating] = (byRating[row.rating] ?? 0) + 1;
        sum += row.rating;
      }
      if (row.comment) withComment++;

      const path = row.path || "(unknown)";
      const entry = perPath.get(path) ?? { count: 0, sum: 0 };
      entry.count++;
      if (rated) entry.sum += row.rating;
      perPath.set(path, entry);
    }

    const ratedCount = Object.values(byRating).reduce((a, b) => a + b, 0);

    return {
      total: rows.length,
      averageRating: ratedCount > 0 ? round1(sum / ratedCount) : null,
      byRating,
      byPath: [...perPath.entries()]
        .map(([path, v]) => ({
          path,
          count: v.count,
          averageRating: v.count > 0 ? round1(v.sum / v.count) : 0,
        }))
        // Count first, then path, so the order is stable across reloads when
        // two pages tie — an unstable admin table looks like data churn.
        .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
      withComment,
    };
  }

  async list(sinceIso?: string, limit = FEEDBACK_PAGE_SIZE): Promise<FeedbackResponse[]> {
    const rows = await readFeedbackResponses<FeedbackResponse>(sinceIso);
    return rows.slice(0, limit);
  }

  async listRows(sinceIso?: string, limit = FEEDBACK_PAGE_SIZE): Promise<FeedbackRow[]> {
    const rows = await readFeedbackResponseRows<FeedbackResponse>(sinceIso);
    return rows.slice(0, limit);
  }

  async remove(id: number): Promise<boolean> {
    return (await deleteFeedbackResponseById(id)) > 0;
  }
}

export const feedbackStore: FeedbackStore = new DbFeedbackStore();
