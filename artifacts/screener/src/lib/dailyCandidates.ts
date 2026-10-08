export type DailyPick = {
  candidateId: number; ticker: string; market: string; direction: string; rank: number;
  source: string; signalDate?: string | null; category: string;
  entryPrice: number; stopPrice: number; targetPrice: number; rr: number;
};
export function dailySymbol(ticker: string, market = "SE") {
  const symbol = ticker.trim().toUpperCase();
  return market === "SE" ? symbol.replace(/\.ST$/, "").replace(/[\s_]+([AB])$/, "-$1") : symbol;
}
/** Only trim the existing recommendation list; no new ranking, scoring or position selection. */
export function swedishDailyPicks(picks: readonly DailyPick[]) {
  return (["LONG", "SHORT"] as const).map(direction => ({
    direction,
    picks: picks.filter(p => p.market === "SE" && p.direction === direction)
      .slice().sort((a, b) => a.rank - b.rank)
      .filter((p, i, rows) => rows.findIndex(row => dailySymbol(row.ticker) === dailySymbol(p.ticker)) === i).slice(0, 3),
  }));
}
export function previousWeekday(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
export function oldSignalWarning(date: string | null | undefined, today: string) {
  return !date ? "Signaldatum okänt" : date === today || date === previousWeekday(today)
    ? null : date > today ? "Signaldatum ligger i framtiden" : "Gammalt underlag – inte dagens signal";
}
