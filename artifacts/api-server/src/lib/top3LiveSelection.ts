import {
  buildTop3SelectionSnapshot,
  TOP3_POLICY_VERSION,
  type PolicyCandidate,
} from "./top3SelectionPolicyCore";
import { isAcceptedSignalDate } from "./signalDatePolicy";

export type Top3LiveCandidate = PolicyCandidate & {
  createdAt: Date | null;
};

type LiveSession = {
  sourceReports?: unknown;
  id: number;
  date: string;
  source: string | null;
  top3SnapshotAt: Date | null;
  top3CutoffEvaluatedAt: Date | null;
  top3CutoffAt?: Date | null;
  top3PolicyVersion?: string | null;
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

  const cutoff = session.top3CutoffAt ?? null;
  const observed = candidates.filter((candidate) =>
    (candidate.signalSource === "telegram" || candidate.signalSource === "edgeai") &&
    isAcceptedSignalDate(candidate.signalDate, session.date, candidate.market ?? "SE") &&
    candidate.createdAt instanceof Date &&
    candidate.createdAt.getTime() <= now.getTime(),
  );

  const sourceReceipts = Object.fromEntries(LIVE_SOURCES.map((source) => {
    const sourceCandidates = observed.filter((candidate) => candidate.signalSource === source);
    return [source, {
      received: sourceCandidates.length > 0,
      candidateCount: sourceCandidates.length,
      signalDates: [...new Set(sourceCandidates.map((candidate) => candidate.signalDate!))].sort(),
      receivedBeforeCutoff: sourceCandidates.some(
        (candidate) => cutoff == null ||
          ([TOP3_POLICY_VERSION, "official-top3-v6", "official-top3-v5", "official-top3-v4"].includes(session.top3PolicyVersion ?? "")
            ? candidate.createdAt!.getTime() <= cutoff.getTime()
            : candidate.createdAt!.getTime() < cutoff.getTime()),
      ),
    }];
  })) as Record<(typeof LIVE_SOURCES)[number], {
    received: boolean;
    candidateCount: number;
    signalDates: string[];
    receivedBeforeCutoff: boolean;
  }>;

  const previewAvailable = session.top3SnapshotAt == null &&
    session.top3CutoffEvaluatedAt == null &&
    LIVE_SOURCES.some((source) => sourceReceipts[source].received);

  const picks = previewAvailable
    ? buildTop3SelectionSnapshot(
      observed,
      session.id,
      session.date,
      session.source,
      now,
      Array.isArray(session.sourceReports)?session.sourceReports:[],
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
    cutoffAt: cutoff?.toISOString() ?? null,
    previewAvailable,
    sourceReceipts,
    picks,
  };
}