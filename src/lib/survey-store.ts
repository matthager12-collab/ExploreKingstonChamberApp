// Storage for anonymous LTAC visitor-survey responses.
//
// Append-only Postgres log (survey_response) via the data layer's append
// helpers (src/lib/db/append.ts). No PII is ever collected (see types.ts).

import { appendSurveyResponse, readSurveyResponses } from "./db/append";
import type { SurveyResponse } from "./types";

export interface SurveyStore {
  save(response: SurveyResponse): Promise<void>;
  /** Aggregate counts for the LTAC report — never raw rows with timestamps. */
  summarize(): Promise<SurveySummary>;
}

export interface SurveySummary {
  total: number;
  byDistance: Record<string, number>;
  overnightCount: number;
  totalLodgingNights: number;
}

class DbSurveyStore implements SurveyStore {
  async save(response: SurveyResponse): Promise<void> {
    await appendSurveyResponse(response);
  }

  async summarize(): Promise<SurveySummary> {
    const rows = await readSurveyResponses<SurveyResponse>();
    const byDistance: Record<string, number> = {};
    for (const r of rows) {
      byDistance[r.distanceBand] = (byDistance[r.distanceBand] ?? 0) + 1;
    }
    return {
      total: rows.length,
      byDistance,
      overnightCount: rows.filter((r) => r.overnight).length,
      totalLodgingNights: rows.reduce((sum, r) => sum + (r.lodgingNights ?? 0), 0),
    };
  }
}

export const surveyStore: SurveyStore = new DbSurveyStore();
