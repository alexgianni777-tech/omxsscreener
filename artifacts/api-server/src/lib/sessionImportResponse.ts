import { ImportSessionResponse } from "@workspace/api-zod";
import type { screenerSessionsTable } from "@workspace/db";
import { describeTop3Snapshot } from "./top3SnapshotStatus";
import { buildTop3LiveSelection, type Top3LiveCandidate } from "./top3LiveSelection";

/** Both import endpoints return the same complete session contract. */
export function parseSessionImportResponse(
  session: typeof screenerSessionsTable.$inferSelect,
  candidates: unknown[],
  importDiff?: unknown,
  rawPolicyCandidates: Top3LiveCandidate[] = [],
  now = new Date(),
) {
  return ImportSessionResponse.parse({
    id: session.id,
    date: session.date,
    source: session.source ?? null,
    createdAt: session.createdAt ?? null,
    lastImportAt: session.lastImportAt ?? null,
    sourceReports: Array.isArray(session.sourceReports) ? session.sourceReports : [],
    marketWeather: {
      omxsValue: session.omxsValue,
      perf5d: session.perf5d,
      perf1m: session.perf1m,
      perf3m: session.perf3m,
      rsi: session.marketRsi,
      trendLabel: session.trendLabel,
    },
    candidates,
    importDiff,
    top3SelectionSnapshot: describeTop3Snapshot(session, now),
    top3LiveSelection: buildTop3LiveSelection(session, rawPolicyCandidates, now),
  });
}