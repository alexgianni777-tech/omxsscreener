import { marketDate, observedReportDate, previousMarketDay, reportWindow, signalSessionDate } from "@workspace/market-calendar";
import type { SessionSourceReport } from "@workspace/api-client-react";

export type Qualification = { status: "QUALIFIED" | "WATCH" | "RESEARCH" | "BLOCKED"; reasons: string[] };
export type Regime = { state: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
  source: string | null; dataDate: string | null };
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Only co-located index close/SMA values with explicit provenance are comparable.
 * Never combine a stock SMA with an index, or two different source dates.
 */
export function marketRegime(reports: readonly SessionSourceReport[], market: string, dataDate: string | null, now = new Date()): Regime {
  const unknown: Regime = { state: "UNKNOWN", source: null, dataDate };
  if (market !== "SE" && market !== "US") return unknown;
  const snapshots = reports.filter(r => r.status === "SUCCESS").flatMap(r => {
    const s = r.marketContext?.[market], i = s?.indexSnapshot as Record<string, unknown> | undefined;
    if (s?.dataAsOf !== dataDate || r.dataDates?.[market] !== dataDate || !i || !positive(i.close) || !positive(i.sma50) || !positive(i.sma200) ||
      typeof i.source !== "string" || !i.source.trim() || typeof i.asOf !== "string" ||
      !Number.isFinite(Date.parse(i.asOf)) || Date.parse(i.asOf) > now.getTime() ||
      marketDate(new Date(i.asOf), market) !== dataDate ||
      signalSessionDate(new Date(i.asOf), market) <= dataDate!) return [];
    return [{ close: i.close, sma50: i.sma50, sma200: i.sma200, source: i.source }];
  });
  const first = snapshots[0];
  if (!first || snapshots.some(s => s.close !== first.close || s.sma50 !== first.sma50 || s.sma200 !== first.sma200)) return unknown;
  return { source: first.source, dataDate,
    state: first.close > first.sma50 && first.sma50 > first.sma200 ? "BULLISH"
      : first.close < first.sma50 && first.sma50 < first.sma200 ? "BEARISH" : "NEUTRAL" };
}

export type ResearchEvidence = {
  category?: string; direction?: string; signalSource?: string | null; market?: string | null;
  signalDate?: string | null; dataDate?: string | null; atr?: number | null;
  rsi?: number | null; signalRsi?: number | null; perf1m?: number; rs3m?: number;
  volMultiplier?: number; earningsInDays?: number | null; earningsKnowledge?: string | null;
  review?: { status: string; reasons: string[] };
  entryPrice?:number; stopPrice?:number; targetPrice?:number;
};
export function qualifyResearch(e: ResearchEvidence, regime: Regime = { state: "UNKNOWN", source: null, dataDate: null }, now = new Date()): Qualification {
  const blocked: string[] = [], watch: string[] = [];
  if (!["telegram","edgeai","manual","screener"].includes(e.signalSource ?? "")) blocked.push("UNKNOWN_SOURCE");
  if (!["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST", "SVAGAST"].includes(e.category ?? ""))
    watch.push("Okänd modul – ingen automatisk kvalificering.");
  const market = e.market === "US" ? "US" : "SE";
  const expected = previousMarketDay(signalSessionDate(now, market), market);
  if (!["SE", "US"].includes(e.market ?? "") || !e.dataDate || e.dataDate !== expected)
    blocked.push("STALE/UNKNOWN_DATA_DATE – verifierad senaste avslutade marknadsdag krävs.");
  if (!["LONG", "SHORT"].includes(e.direction ?? "")) blocked.push("UNKNOWN_DIRECTION");
  const grossRR=Math.abs(e.targetPrice!-e.entryPrice!)/Math.abs(e.entryPrice!-e.stopPrice!);
  if (![e.entryPrice,e.stopPrice,e.targetPrice].every(positive) || !Number.isFinite(grossRR) ||
    (e.direction==="LONG" ? !(e.stopPrice!<e.entryPrice!&&e.entryPrice!<e.targetPrice!)
      : !(e.targetPrice!<e.entryPrice!&&e.entryPrice!<e.stopPrice!)) ||
    grossRR<1.2)
    blocked.push("INVALID_PLAN – verifierad entry/stop/target och brutto-R/R ≥ 1,2 krävs.");
  if (e.review?.status === "BLOCKED") blocked.push(...e.review.reasons);
  const reportDate = observedReportDate(e.signalDate, e.earningsInDays, e.earningsKnowledge);
  const report = reportWindow(reportDate, marketDate(now, market), e.market ?? "");
  if (report.blocked) blocked.push(`${report.status} – rapportkontroll krävs före kvalificering.`);
  if (!positive(e.volMultiplier)) blocked.push("Volymdata saknas/är ogiltig.");
  if (![e.perf1m, e.rs3m].every(n => typeof n === "number" && Number.isFinite(n)))
    blocked.push("Trendserien saknar ändliga perf1m/rs3m-värden.");
  const rsi = e.signalSource === "edgeai" ? e.signalRsi : e.rsi;
  if (rsi == null || !Number.isFinite(rsi) || rsi < 0 || rsi > 100) watch.push("RSI ej verifierad.");
  if (e.signalSource === "edgeai" || !positive(e.atr)) watch.push("ATR för underliggande ej verifierad; edge-statistik ersätter inte ATR.");
  if (e.category === "MOMENTUM" && e.direction === "LONG" && ((e.perf1m ?? 0) <= 0 || (e.rs3m ?? 0) <= 0))
    blocked.push("Momentum saknar positiv utveckling/relativ styrka.");
  if (regime.state === "UNKNOWN" || regime.dataDate !== e.dataDate || !regime.source)
    watch.push("SMA50/SMA200-marknadsregim saknar verifierat underlag.");
  else if (regime.state === "NEUTRAL" || (e.direction === "LONG" && regime.state === "BEARISH") ||
    (e.direction === "SHORT" && regime.state === "BULLISH")) watch.push("Motstridig/neutral marknadsregim – endast WATCH.");
  const research = ["STUDS", "WEAKEST", "SVAGAST"].includes(e.category ?? "");
  const reasons = [...new Set([...blocked, ...watch, ...(research ? ["RESEARCH – oberoende netto-positiv expectancy är inte verifierad för modulen."] : [])])];
  return { status: blocked.length ? "BLOCKED" : research ? "RESEARCH" : watch.length ? "WATCH" : "QUALIFIED", reasons };
}
