import {
  buildTop3SelectionSnapshot,
  top3CutoffForDate,
  type PolicyCandidate,
} from "./top3SelectionPolicyCore";

export type Top3LiveCandidate = PolicyCandidate & {
  createdAt: Date | null;
};

type LiveSession = {
  id: number;
  date: string;
  source: string | null;
  top3SnapshotAt: Date | null;
  top3CutoffEvaluatedAt: Date | null;
};

const STOCKHOLM_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const LIVE_SOURCES = ["telegram", "edgeai"] as const;

/** Build read-only current-day source receipts and an explicitly preliminary selection. */
export function buildTop3LiveSelection(
  session: LiveSession,
  candidates: Top3LiveCandidate[],
  now = new Date(),
) {
  const today = STOCKHOLM_DATE.format(now);
  if (session.date !== today) return undefined;

  const cutoff = top3CutoffForDate(session.date);
  const observed = candidates.filter((candidate) =>
    (candidate.signalSource === "telegram" || candidate.signalSource === "edgeai") &&
    candidate.signalDate === session.date &&
    candidate.createdAt instanceof Date &&
    candidate.createdAt.getTime() <= now.getTime(),
  );

  const sourceReceipts = Object.fromEntries(LIVE_SOURCES.map((source) => {
    const sourceCandidates = observed.filter((candidate) => candidate.signalSource === source);
    return [source, {
      received: sourceCandidates.length > 0,
      candidateCount: sourceCandidates.length,
      receivedBeforeCutoff: sourceCandidates.some(
        (candidate) => candidate.createdAt!.getTime() < cutoff.getTime(),
      ),
    }];
  })) as Record<(typeof LIVE_SOURCES)[number], {
    received: boolean;
    candidateCount: number;
    receivedBeforeCutoff: boolean;
  }>;

  const previewAvailable = now.getTime() < cutoff.getTime() &&
    session.top3SnapshotAt == null &&
    session.top3CutoffEvaluatedAt == null &&
    LIVE_SOURCES.some((source) => sourceReceipts[source].received);

  const picks = previewAvailable
    ? buildTop3SelectionSnapshot(
      observed,
      session.id,
      session.date,
      session.source,
      now,
    )
      .filter((selection) =>
        selection.selected &&
        selection.rank != null &&
        (selection.market === "SE" || selection.market === "US") &&
        (selection.source === "telegram" || selection.source === "edgeai"),
      )
      .map((selection) => ({
        candidateId: selection.candidateId,
        rank: selection.rank!,
        score: selection.score,
        market: selection.market as "SE" | "US",
        direction: selection.direction,
        signalSource: selection.source as "telegram" | "edgeai",
      }))
    : [];

  return {
    evaluatedAt: now.toISOString(),
    cutoffAt: cutoff.toISOString(),
    previewAvailable,
    sourceReceipts,
    picks,
  };
}