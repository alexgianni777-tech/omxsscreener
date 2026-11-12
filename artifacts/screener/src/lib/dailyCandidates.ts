import type { CandidateDataQuality, SessionSourceReport } from "@workspace/api-client-react";
import { acceptedReportDate } from "@workspace/market-calendar";
export type DailyPick = {
  candidateId: number; ticker: string; market: string; direction: string; rank: number;
  source: string; signalDate?: string | null; category: string;
  entryPrice: number; stopPrice: number; targetPrice: number; rr: number;
  dataQuality?: CandidateDataQuality | null;
};
export function dailySymbol(ticker: string, market = "SE") {
  const symbol = ticker.trim().toUpperCase();
  return market === "SE" ? symbol.replace(/\.ST$/, "").replace(/[\s_]+([AB])$/, "-$1") : symbol;
}
export function isolatedDailyPick(p: DailyPick, reports: readonly SessionSourceReport[]) {
  const latest = [...reports].reverse().find(r => r.status !== "FAILED" && r.source === p.source && r.signalDate === p.signalDate);
  const identity = [p.market, p.category, dailySymbol(p.ticker, p.market), p.direction,
    ...(p.signalDate ? [p.signalDate] : []), p.source].join("|");
  return latest?.quarantinedIdentities?.includes(identity) ?? false;
}
/** Only trim the existing recommendation list; no new ranking, scoring or position selection. */
export function swedishDailyPicks(picks: readonly DailyPick[]) {
  return marketDailyPicks(picks, "SE");
}
export function marketDailyPicks(picks: readonly DailyPick[], market: "SE" | "US") {
  return (["LONG", "SHORT"] as const).map(direction => ({
    direction,
    picks: picks.filter(p => p.market === market && p.direction === direction)
      .slice().sort((a, b) => a.rank - b.rank)
      .filter((p, i, rows) => rows.findIndex(row => dailySymbol(row.ticker, market) === dailySymbol(p.ticker, market)) === i).slice(0, 3),
  }));
}
export function previousWeekday(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
export function oldSignalWarning(date: string | null | undefined, today: string, market = "SE") {
  return !date ? "Signaldatum okänt" : acceptedReportDate(date, today, market)
    ? null : date > today ? "Signaldatum ligger i framtiden" : "Gammalt underlag – inte dagens signal";
}
