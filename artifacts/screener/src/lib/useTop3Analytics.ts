import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface Top3Pick {
  ticker: string;
  direction: string;
  edgeScore: number;
  outcome: string;
  r: number | null;
}

export interface Top3Session {
  date: string;
  sessionId: number;
  picks: Top3Pick[];
  sessionR: number | null;
  cumulativeR: number;
}

export interface Top3Stats {
  totalSessions: number;
  completedSessions: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalR: number;
  avgRPerTrade: number | null;
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
  });
}
