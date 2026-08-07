// "I'm going" tallies — the domain API every consumer imports.
//
// Thin wrapper over src/lib/db/event-going.ts, exactly as worklist-store wraps
// db/worklist: route handlers and pages import from here, never from
// src/lib/db directly (lint:boundaries enforces it).

export {
  countGoingBefore,
  deleteGoingBefore,
  getGoingByZip,
  getGoingCounts,
  normalizeZip,
  recordGoing,
} from "@/lib/db/event-going";
