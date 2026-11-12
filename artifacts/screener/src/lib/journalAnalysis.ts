import type { JournalRecord } from "@workspace/api-client-react";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const instant = (s: string | null | undefined) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) return false;
  return new Date(`${s.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === s.slice(0, 10);
};
const close = (a: number, b: number) => finite(a) && finite(b) &&
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const label=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():"UNKNOWN";

function netStatistics(rows: ReturnType<typeof executionAnalysis>[]) {
  const sample = rows.filter(r=>r.executed && r.netR!=null).sort((a,b)=>
    Date.parse(a.record.input.exitTime!)-Date.parse(b.record.input.exitTime!) || a.record.id.localeCompare(b.record.id));
  const values=sample.map(r=>r.netR!);
  const wins=values.filter(r=>r>0), losses=values.filter(r=>r<0);
  const sum=(a:number[])=>a.reduce((s,n)=>s+n,0);
  let equity=0,peak=0,drawdown=0;
  for (const value of values) { equity+=value; peak=Math.max(peak,equity); drawdown=Math.max(drawdown,peak-equity); }
  const average=(a:number[])=>a.length?sum(a)/a.length:null;
  const sumsValid=[sum(wins),sum(losses)].every(finite);
  const profitFactor=losses.length&&sumsValid?sum(wins)/Math.abs(sum(losses)):null;
  const payoff=wins.length&&losses.length&&sumsValid?average(wins)!/Math.abs(average(losses)!):null;
  const valid=[equity,drawdown].every(Number.isFinite);
  const exits=new Map<string,number[]>();
  for(const row of sample){
    const key=new Date(row.record.input.exitTime!).toISOString();
    exits.set(key,[...(exits.get(key)??[]),row.netR!]);
  }
  const ambiguous=[...exits.values()].some(group=>group.some(r=>r>0)&&group.some(r=>r<0));
  return { n:sample.length, status:!sample.length||!valid?"NOT_VERIFIED":sample.length<20?"INSUFFICIENT_DATA":"DESCRIPTIVE_ONLY",
    netExpectancy:valid?average(values):null, winRate:sample.length?wins.length/sample.length:null,
    profitFactor:finite(profitFactor)?profitFactor:null, payoff:finite(payoff)?payoff:null,
    maxDrawdownR:sample.length&&valid&&!ambiguous?drawdown:null,
    profitFactorStatus:!sample.length?"NOT_VERIFIED":!losses.length?"NO_LOSS_OBSERVATIONS":!finite(profitFactor)?"NOT_VERIFIED":"DESCRIPTIVE_ONLY",
    payoffStatus:!sample.length?"NOT_VERIFIED":!wins.length||!losses.length?"BOTH_SIDES_REQUIRED":!finite(payoff)?"NOT_VERIFIED":"DESCRIPTIVE_ONLY",
    drawdownStatus:!sample.length||!valid?"NOT_VERIFIED":ambiguous?"AMBIGUOUS_EXIT_ORDER":"DESCRIPTIVE_ONLY" };
}

/** Execution evidence only. Never backfills from the signal's plan/outcome. */
export function executionAnalysis(record: JournalRecord, now = Date.now()) {
  const i = record.input, m = record.metrics;
  const issues: string[] = [];
  const exclusionReasons:string[]=[];
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
  const observationCosts=[i.spreadCostKr,i.slippageCostKr].every(n=>n==null||(finite(n)&&n>=0));
  const costs = [i.financingCostKr, i.commissionKr].every(n => finite(n) && n >= 0)&&observationCosts;
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
  const rawGrossR=positive(risk)&&grossPnl!=null?grossPnl/risk:null;
  const grossR=finite(rawGrossR)?rawGrossR:null;
  if (computedNet != null && netPnl == null) issues.push("Nettofälten saknas eller motsäger exekveringsunderlaget.");
  if (netR == null && i.mode !== "NOT_TAKEN") issues.push("Netto-R ej verifierat: risk-/stopunderlag saknas eller är inkonsekvent.");
  if(i.mode==="REAL"){
    if(!evidence||grossPnl==null)exclusionReasons.push("EXECUTION_NOT_VERIFIED");
    if(!costs)exclusionReasons.push("COSTS_NOT_VERIFIED");
    if(!validStop||!positive(risk))exclusionReasons.push("INVALID_STOP_OR_RISK");
    if(computedNet!=null&&netPnl==null)exclusionReasons.push("NET_PNL_MISMATCH");
    if(positive(risk)&&(!finite(m.riskCashKr)||!close(risk,m.riskCashKr)))exclusionReasons.push("RISK_MISMATCH");
    if(netPnl!=null&&positive(risk)&&(!finite(m.netR)||!close(netPnl/risk,m.netR)))exclusionReasons.push("NET_R_MISMATCH");
  }
  return { record, grossPnl, grossR, netPnl, netR, issues, exclusionReasons,
    verification:netR==null?"NOT_VERIFIED":"ARITHMETICALLY_VERIFIED",executed: evidence && i.mode === "REAL" };
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
  const groups = new Map<string, typeof sample>();
  const dimensions={source:new Map<string,typeof sample>(),module:new Map<string,typeof sample>(),
    direction:new Map<string,typeof sample>(),regime:new Map<string,typeof sample>()};
  for (const r of sample) {
    // Journal contract has no historical SMA regime. Never fill it using today's index.
    const key = `${r.record.signal.source ?? "UNKNOWN"} · ${r.record.signal.bucket ?? "UNKNOWN"} · ${r.record.signal.direction ?? "UNKNOWN"} · regim UNKNOWN`;
    groups.set(key,[...(groups.get(key)??[]),r]);
    const labels={source:label(r.record.signal.source),module:label(r.record.signal.bucket),
      direction:["LONG","SHORT"].includes(r.record.signal.direction)?r.record.signal.direction:"UNKNOWN",regime:"UNKNOWN"};
    for(const dimension of ["source","module","direction","regime"] as const){
      const label=labels[dimension];
      dimensions[dimension].set(label,[...(dimensions[dimension].get(label)??[]),r]);
    }
  }
  const summarize=(groups:Map<string,typeof sample>)=>[...groups].sort(([a],[b])=>a.localeCompare(b))
    .map(([key,rows])=>({key,...netStatistics(rows)}));
  const exclusions=new Map<string,number>();
  for(const row of real.filter(row=>row.netR==null))
    for(const reason of row.exclusionReasons)exclusions.set(reason,(exclusions.get(reason)??0)+1);
  return { rows, real: real.length, sample: sample.length, excluded: real.length - sample.length,
    net:netStatistics(sample), groups:summarize(groups),
    dimensions:{source:summarize(dimensions.source),module:summarize(dimensions.module),
      direction:summarize(dimensions.direction),regime:summarize(dimensions.regime)},
    exclusions:[...exclusions].map(([reason,count])=>({reason,count})),
    winRate: sample.length ? wins.length / sample.length : null, winR, lossR,
    payoff: winR != null && lossR != null && lossR < 0 && finite(winR / Math.abs(lossR)) ? winR / Math.abs(lossR) : null,
    simulated: rows.filter(r => r.record.input.mode === "SIMULATED").length,
    notTaken: rows.filter(r => r.record.input.mode === "NOT_TAKEN").length };
}
