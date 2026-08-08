import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface MarketIntelData {
  fearGreed: {
    score: number;
    rating: string;
    previousClose: number;
    previousWeek: number;
    previousMonth: number;
  } | null;
  pe: {
    sp500: { trailing: number | null; forward: number | null };
    nasdaq: { trailing: number | null; forward: number | null };
    omxs30: { trailing: number | null; forward: number | null };
  };
  fetchedAt: string;
}

export function useMarketIntel() {
  return useQuery<MarketIntelData>({
    queryKey: ["market-intel"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/market-intel`);
      if (!res.ok) throw new Error("Failed to load market intel");
      return res.json() as Promise<MarketIntelData>;
    },
    staleTime: 15 * 60_000,
    retry: 1,
  });
}
