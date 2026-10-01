import { ImportSessionResponse } from "@workspace/api-zod";
import type { screenerSessionsTable } from "@workspace/db";
import { describeTop3Snapshot } from "./top3SnapshotStatus";

/** Both import endpoints return the same complete session contract. */
export function parseSessionImportResponse(
  session: typeof screenerSessionsTable.$inferSelect,
  candidates: unknown[],
  importDiff?: unknown,
) {
  return ImportSessionResponse.parse({
    id: session.id,
    date: session.date,
    source: session.source ?? null,
    createdAt: session.createdAt ?? null,
    lastImportAt: session.lastImportAt ?? null,
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
    top3SelectionSnapshot: describeTop3Snapshot(session),
  });
}