/**
 * AG Invest risk planner for UNDERLYING shares, with manual product assumptions.
 * Instrument values are illustrative only, not live mini-future pricing.
 * NO broker/order functionality in this module.
 */
export type TradeDirection = "LONG" | "SHORT";
export type RiskInputs = {
  capitalKr: number;
  accountRiskPct: number;
  leverageX: number;
  direction: TradeDirection;
  entry: number;
  stop: number;
  target: number;
  instrumentRoundtripCostPct: number;
  knockoutDistancePct: number | null;
};
export type RiskResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  underlyingStopPct: number;
  underlyingTargetPct: number;
  estimatedInstrumentLossPct: number;
  estimatedInstrumentWinPct: number;
  maximumInvestmentKr: number;
  estimatedLossKr: number;
  estimatedWinKr: number;
  exposureKr: number;
  rr: number | null;
};

export function calculateLeverageRisk(i: RiskInputs): RiskResult {
  const errors: string[] = [], warnings: string[] = [];
  const result: RiskResult = {
    valid: false, errors, warnings,
    underlyingStopPct: 0, underlyingTargetPct: 0,
    estimatedInstrumentLossPct: 0, estimatedInstrumentWinPct: 0,
    maximumInvestmentKr: 0, estimatedLossKr: 0, estimatedWinKr: 0,
    exposureKr: 0, rr: null,
  };
  const numeric = [i.capitalKr, i.accountRiskPct, i.leverageX, i.entry, i.stop, i.target, i.instrumentRoundtripCostPct];
  if (numeric.some(x => !Number.isFinite(x))) { errors.push("Samtliga fält måste innehålla giltiga tal."); return result; }
  if (i.capitalKr <= 0 || i.entry <= 0 || i.stop <= 0 || i.target <= 0) errors.push("Kapital och alla priser måste vara större än noll.");
  if (i.accountRiskPct <= 0 || i.accountRiskPct > 4) errors.push("Planerad portföljrisk måste vara större än 0 och högst 4 %.");
  if (![4, 6, 8].includes(i.leverageX)) errors.push("Välj 4×, 6× eller 8×.");
  if (i.instrumentRoundtripCostPct < 0 || i.instrumentRoundtripCostPct > 100) errors.push("Ogiltig kostnadsandel.");
  const long = i.direction === "LONG";
  if (long ? !(i.stop < i.entry && i.target > i.entry) : !(i.stop > i.entry && i.target < i.entry)) {
    errors.push("Stop och mål måste ligga på rätt sida om ingångspriset.");
  }
  if (errors.length) return result;
  const stopPct = Math.abs(i.stop / i.entry - 1) * 100;
  const targetPct = Math.abs(i.target / i.entry - 1) * 100;
  const stopFraction = Math.min(1, (i.leverageX * stopPct + i.instrumentRoundtripCostPct) / 100);
  const winFraction = (i.leverageX * targetPct - i.instrumentRoundtripCostPct) / 100;
  const investment = Math.min(i.capitalKr, (i.capitalKr * i.accountRiskPct / 100) / stopFraction);
  result.underlyingStopPct = stopPct;
  result.underlyingTargetPct = targetPct;
  result.estimatedInstrumentLossPct = stopFraction * 100;
  result.estimatedInstrumentWinPct = winFraction * 100;
  result.maximumInvestmentKr = investment;
  result.estimatedLossKr = investment * stopFraction;
  result.estimatedWinKr = investment * winFraction;
  result.exposureKr = investment * i.leverageX;
  result.rr = winFraction > 0 ? winFraction / stopFraction : null;
  if (i.knockoutDistancePct == null || !Number.isFinite(i.knockoutDistancePct)) {
    warnings.push("Knockout-avstånd inte verifierat: instrumentet får inte godkännas utan produktkontroll.");
  } else if (i.knockoutDistancePct <= stopPct) {
    warnings.push("Knockout riskerar inträffa innan planerad stop-loss. Underkänn instrumentet.");
  } else if (i.knockoutDistancePct < stopPct * 1.5) {
    warnings.push("Litet avstånd mellan planerad stop och knockout. Förhöjd risk.");
  }
  if (winFraction <= 0) warnings.push("Handelskostnaden överstiger den modellerade målvinsten.");
  if (result.rr != null && result.rr < 1.5) warnings.push("R/R efter kostnad är under 1,5.");
  if (i.leverageX >= 8) warnings.push("8× innebär extra hög risk vid gap, slippage och förändrad indikativ hävstång.");
  warnings.push("Detta är en approximation: faktisk mini-future-prissättning, emittentspread och gap kan ge större förlust, upp till hela insatsen.");
  result.valid = true;
  return result;
}
