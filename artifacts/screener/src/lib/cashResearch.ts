export type CashEvidence = {
  cash: number; shortTermInvestments: number; interestBearingDebt: number;
  fcf: number; previousFcf: number; interestCoverage: number; previousCoverage: number;
  earningsGrowth: number; valuationMultiple: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL"; currency: string;
  period: string; previousPeriod: string; source: string; publishedAt: string;
  asOf: string; provenanceVerified: boolean;
};
/** Classification is descriptive research, NEVER a trading qualification.
 * No external fetch, imputation, zero-fill or cross-period/currency merging.
 */
export function cashResearch(e?: CashEvidence | null, now = Date.now()) {
  const missing = ["cash", "shortTermInvestments", "interestBearingDebt", "fcf", "previousFcf", "interestCoverage",
    "previousCoverage", "earningsGrowth", "valuationMultiple", "currency", "period", "previousPeriod", "source", "publishedAt", "asOf", "trend"];
  if (!e || !e.provenanceVerified ||
    ![e.cash,e.shortTermInvestments,e.interestBearingDebt,e.fcf,e.previousFcf,e.interestCoverage,e.previousCoverage,e.earningsGrowth,e.valuationMultiple].every(Number.isFinite) ||
    [e.cash,e.shortTermInvestments,e.interestBearingDebt].some(n=>n<0) ||
    !/^[A-Z]{3}$/.test(e.currency) ||
    ![e.period,e.previousPeriod].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d) || e.previousPeriod>=e.period ||
    !e.source.trim() || ![e.asOf,e.publishedAt].every(d=>Number.isFinite(Date.parse(d)) && Date.parse(d)<=now) ||
    Date.parse(e.period)>Date.parse(e.publishedAt) || Date.parse(e.publishedAt)>Date.parse(e.asOf) ||
    now-Date.parse(e.asOf)>120*86400_000 || !["BULLISH","BEARISH","NEUTRAL"].includes(e.trend)) {
    return {status:"DATA_MISSING" as const,classification:null,netCash:null,missing};
  }
  const netCash = e.cash + e.shortTermInvestments - e.interestBearingDebt;
  if (!Number.isFinite(netCash)) return {status:"DATA_MISSING" as const,classification:null,netCash:null,missing};
  const strong = netCash>0 && e.fcf>0 && e.fcf>=e.previousFcf && e.trend==="BULLISH" &&
    e.earningsGrowth>0 && e.valuationMultiple>0;
  const weak = netCash<0 && e.fcf<e.previousFcf && e.interestCoverage<e.previousCoverage &&
    e.earningsGrowth<0 && e.trend==="BEARISH";
  return {status:strong||weak?"RESEARCH" as const:"WATCH" as const,
    classification:strong?"CASH STRONG":weak?"CASH WEAK":null,netCash,missing:[]};
}
