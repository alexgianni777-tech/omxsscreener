import type { JournalRecord } from "@workspace/api-client-react";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const instant = (s: string | null | undefined) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) return false;
  return new Date(`${s.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === s.slice(0, 10);
};
const close = (a: number, b: number) => finite(a) && finite(b) &&
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));

/** Execution evidence only. Never backfills from the signal's plan/outcome. */
export function executionAnalysis(record: JournalRecord, now = Date.now()) {
  const i = record.input, m = record.metrics;
  const issues: string[] = [];
  const entryFx = i.priceCurrency === "SEK" ? 1 : i.priceCurrency === "USD" ? i.entryFxSek : null;
  const exitFx = i.priceCurrency === "SEK" ? 1 : i.priceCurrency === "USD" ? i.exitFxSek : null;
  const times = instant(i.entryTime) && instant(i.exitTime) &&
    Date.parse(i.exitTime!) >= Date.parse(i.entryTime!) && Date.parse(i.exitTime!) <= now;
  const currencies = positive(entryFx) && positive(exitFx) &&
    !(i.priceCurrency === "SEK" && ((i.entryFxSek != null && i.entryFxSek !== 1) || (i.exitFxSek != null && i.exitFxSek !== 1)));
  const evidence = (i.mode === "REAL" || i.mode === "SIMULATED") && ["SHARE", "PRODUCT"].includes(i.instrumentKind ?? "") &&
    ["LONG", "SHORT"].includes(i.side ?? "") && times && currencies &&
    positive(i.fillPrice) && positive(i.exitPrice) && positive(i.quantity);
  const gross = evidence ? (i.side === "LONG" ? 1 : -1) *
    (i.exitPrice! * exitFx! - i.fillPrice! * entryFx!) * i.quantity! : null;
  const grossPnl = finite(gross) ? gross : null;
  if (!evidence && i.mode !== "NOT_TAKEN") issues.push("Fill/exit, antal, tid, instrumentsida eller valuta/FX saknas/är ogiltiga.");
  if (!positive(i.stopPrice) && i.mode !== "NOT_TAKEN") issues.push("Faktisk stop saknas/är ogiltig; signalens stop används inte som ersättning.");
  if (!positive(i.targetPrice) && i.mode !== "NOT_TAKEN") issues.push("Faktiskt mål saknas; signalens mål används inte som ersättning.");
  const costs = [i.financingCostKr, i.commissionKr].every(n => finite(n) && n >= 0);
  if (!costs && i.mode !== "NOT_TAKEN") issues.push("Finansiering/courtage okänt: inget verifierat nettoresultat.");
  if (i.mode !== "NOT_TAKEN" && (i.spreadCostKr == null || i.slippageCostKr == null))
    issues.push("Spread/slippage ej separat observerade; faktiska fills används, ingen kostnad uppskattas.");
  const computedNet = grossPnl != null && costs ? grossPnl - i.financingCostKr! - i.commissionKr! : null;
  const netPnl = computedNet != null && finite(m.netPnlKr) && close(computedNet, m.netPnlKr) ? m.netPnlKr : null;
  const validStop = evidence && positive(i.stopPrice) &&
    (i.side === "LONG" ? i.stopPrice < i.fillPrice! : i.stopPrice > i.fillPrice!);
  const risk = validStop ? Math.abs(i.fillPrice! - i.stopPrice!) * i.quantity! * entryFx! : null;
  const netR = netPnl != null && positive(risk) && finite(m.riskCashKr) && close(risk, m.riskCashKr) &&
    finite(m.netR) && close(netPnl / risk, m.netR) ? m.netR : null;
  if (computedNet != null && netPnl == null) issues.push("Nettofälten saknas eller motsäger exekveringsunderlaget.");
  if (netR == null && i.mode !== "NOT_TAKEN") issues.push("Netto-R ej verifierat: risk-/stopunderlag saknas eller är inkonsekvent.");
  return { record, grossPnl, netPnl, netR, issues, executed: evidence && i.mode === "REAL" };
}
export function journalAnalysis(records: readonly JournalRecord[], now = Date.now()) {
  const rows = records.map(r => executionAnalysis(r, now));
  const real = rows.filter(r => r.record.input.mode === "REAL");
  const sample = real.filter(r => r.executed && r.netR != null);
  const wins = sample.filter(r => r.netR! > 0), losses = sample.filter(r => r.netR! < 0);
  const mean = (a: typeof sample) => {
    const value = a.length ? a.reduce((s, r) => s + r.netR! / a.length, 0) : null;
    return finite(value) ? value : null;
  };
  const winR = mean(wins), lossR = mean(losses);
  return { rows, real: real.length, sample: sample.length, excluded: real.length - sample.length,
    winRate: sample.length ? wins.length / sample.length : null, winR, lossR,
    payoff: winR != null && lossR != null && lossR < 0 && finite(winR / Math.abs(lossR)) ? winR / Math.abs(lossR) : null,
    simulated: rows.filter(r => r.record.input.mode === "SIMULATED").length,
    notTaken: rows.filter(r => r.record.input.mode === "NOT_TAKEN").length };
}
