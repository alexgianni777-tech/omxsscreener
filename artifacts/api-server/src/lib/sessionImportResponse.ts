import { ImportSessionResponse } from "@workspace/api-zod";
import type { screenerSessionsTable } from "@workspace/db";
import { describeTop3Snapshot } from "./top3SnapshotStatus";
import { buildTop3LiveSelection, type Top3LiveCandidate } from "./top3LiveSelection";
import { sessionMarketEvidence } from "./sourceMarketContext";

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
    marketWeather: sessionMarketEvidence(session).weather,
    candidates,
    importDiff,
    top3SelectionSnapshot: describeTop3Snapshot(session, now),
    top3LiveSelection: buildTop3LiveSelection(session, rawPolicyCandidates, now),
  });
}