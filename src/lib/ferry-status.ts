// One assembled ferry-status snapshot, shared by the /api/ferry/status route
// (client polling) and the server pages that render the initial state — so the
// home widget hydrates from the same shape it later polls.

import {
  getRouteAlerts,
  getRouteDelays,
  getSailingSpace,
  getTerminalStatus,
  getTodaysSailings,
  type BoardingPassStatus,
  type RouteDelays,
  type SailingSpace,
} from "./wsf";
import { getEffectiveBoardingPass } from "./stores/boarding-pass-store";
import { getFastFerrySailings } from "./kitsap";
import type { Sailing, TerminalStatus } from "./types";

export interface FerryStatusSnapshot {
  carFerry: { sailings: Sailing[]; live: boolean };
  fastFerry: { sailings: Sailing[]; live: boolean };
  terminals: { kingston: TerminalStatus; edmonds: TerminalStatus };
  alerts: string[];
  delays: RouteDelays;
  sailingSpace: { kingston: SailingSpace[]; edmonds: SailingSpace[] };
  boardingPass: BoardingPassStatus;
}

export async function getFerryStatusSnapshot(): Promise<FerryStatusSnapshot> {
  const [carFerry, kingston, edmonds, alerts, delays, spaceFromKingston, spaceFromEdmonds, boardingPass] =
    await Promise.all([
      getTodaysSailings(),
      getTerminalStatus("kingston"),
      getTerminalStatus("edmonds"),
      getRouteAlerts(),
      getRouteDelays(),
      getSailingSpace("kingston"),
      getSailingSpace("edmonds"),
      getEffectiveBoardingPass(),
    ]);
  return {
    carFerry,
    fastFerry: getFastFerrySailings(),
    terminals: { kingston, edmonds },
    alerts,
    delays,
    sailingSpace: { kingston: spaceFromKingston, edmonds: spaceFromEdmonds },
    boardingPass,
  };
}
