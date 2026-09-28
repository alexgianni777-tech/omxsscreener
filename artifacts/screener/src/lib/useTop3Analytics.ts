import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface Top3Pick {
  candidateId: number;
  ticker: string;
  category: string;
  market: "SE" | "US" | null;
  direction: string;
  signalSource: string | null;
  edgeScore: number;
  rank: number | null;
  type: string;
  policyVersion: string;
  selectedAt: string;
  review: { status: string; reasons: string[] };
  decision: { status: string; reasons: string[] };
  outcome: string;
  r: number | null;
  earningsWarning: boolean;
}

export interface Top3Session {
  date: string;
  sessionId: number;
  source: string | null;
  selectionStatus: "AVAILABLE" | "UNAVAILABLE";
  selectionUnavailableReason: string | null;
  cutoffState: "AVAILABLE" | "WAITING_FOR_CUTOFF" | "EVALUATING" | "MISSING_SOURCES" | "LEGACY_UNAVAILABLE";
  cutoffAt: string | null;
  cutoffEvaluatedAt: string | null;
  participatingSources: Array<"telegram" | "edgeai"> | null;
  requiredSources: Array<"telegram" | "edgeai">;
  selectedAt: string | null;
  policyVersion: string | null;
  picks: Top3Pick[];
  longPicks: Top3Pick[];
  shortPicks: Top3Pick[];
  matured: boolean;
  edgeWinRate: number | null;
  sessionR: number | null;
  cumulativeR: number;
}

export interface Top3DirectionStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalR: number;
  avgRPerTrade: number | null;
}

export interface Top3Stats {
  totalSessions: number;
  availableSessions: number;
  unavailableSessions: number;
  completedSessions: number;
  selectedTrades: number;
  resolvedTrades: number;
  pendingTrades: number;
  excludedTrades: number;
  resolutionRate: number | null;
  maturedSessions: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalR: number;
  avgRPerTrade: number | null;
  expectedValue: number | null;
  resolvedOnlyTrades: number;
  resolvedOnlyWins: number;
  resolvedOnlyLosses: number;
  resolvedOnlyWinRate: number | null;
  resolvedOnlyExpectedValue: number | null;
  resolvedOnlyTotalR: number;
  resolvedOnlyAvgRPerTrade: number | null;
  byDirection: {
    LONG: Top3DirectionStats;
    SHORT: Top3DirectionStats;
  };
}

export interface Top3Analytics {
  sessions: Top3Session[];
  stats: Top3Stats;
}

export function useTop3Analytics() {
  return useQuery<Top3Analytics>({
    queryKey: ["top3-analytics"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/screener/analytics/top3`);
      if (!res.ok) throw new Error("Failed to load top-3 analytics");
      return res.json() as Promise<Top3Analytics>;
    },
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000, // auto-refresh every 5 min to pick up new imports
  });
}
