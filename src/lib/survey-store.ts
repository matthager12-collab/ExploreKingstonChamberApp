// Storage for anonymous LTAC visitor-survey responses.
//
// The store is pluggable: local development appends to .data/ltac-responses.jsonl
// so the Chamber can export a file; in production swap in a database-backed
// store (Vercel Postgres / Supabase) by implementing SurveyStore and changing
// the export at the bottom. No PII is ever collected (see types.ts).

import { appendFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { dataPath } from "./data-dir";
import { hasDb, db, ensureSchema } from "./db";
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

const DATA_FILE = dataPath("ltac-responses.jsonl");

class FileSurveyStore implements SurveyStore {
  async save(response: SurveyResponse): Promise<void> {
    if (hasDb()) {
      await ensureSchema();
      const sql = db();
      await sql`INSERT INTO survey_response (response) VALUES (${JSON.stringify(response)}::jsonb)`;
      return;
    }
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    await appendFile(DATA_FILE, JSON.stringify(response) + "\n", "utf8");
  }

  async summarize(): Promise<SurveySummary> {
    let rows: SurveyResponse[];
    if (hasDb()) {
      await ensureSchema();
      const sql = db();
      const result = (await sql`SELECT response FROM survey_response`) as {
        response: SurveyResponse;
      }[];
      rows = result.map((r) => r.response);
    } else {
      let lines: string[] = [];
      try {
        lines = (await readFile(DATA_FILE, "utf8")).split("\n").filter(Boolean);
      } catch {
        // no responses yet
      }
      rows = [];
      let skipped = 0;
      for (const line of lines) {
        try {
          rows.push(JSON.parse(line) as SurveyResponse);
        } catch {
          // skip a corrupt line rather than losing the whole summary
          skipped++;
        }
      }
      if (skipped > 0) console.warn(`survey-store: skipped ${skipped} corrupt line(s)`);
    }
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

export const surveyStore: SurveyStore = new FileSurveyStore();
