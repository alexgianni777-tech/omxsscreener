import { validMarketDate, previousMarketDay, signalSessionDate, marketDate, reportWindow } from "@workspace/market-calendar";

export type CashSource = {
  kind:"ISSUER_FILING"|"EXISTING_VERIFIED_FEED"|"MANUAL_UNVERIFIED"|"TEST_FIXTURE";
  name:string; documentId:string; publishedAt:string;
  verification:"DOCUMENT_MATCHED"|"UNVERIFIED";
};
type Basis = {entityId:string;currency:string;scope:"CONSOLIDATED";source:CashSource};
export type CashBalance = Basis & {
  period:string;cash:number;shortTermInvestments:number;interestBearingDebt:number;
  debtDefinition:"INCLUDING_LEASES"|"EXCLUDING_LEASES"|"UNKNOWN";leaseLiabilities?:number;
};
export type CashFlow = Basis & {
  start:string;end:string;basis:"TTM";method:"OPERATING_CASH_FLOW_MINUS_CAPEX";
  operatingCashFlow:number;capex:number;netIncome?:number;ebit?:number;interestExpense?:number;ebitda?:number;
};
export type CashPolicy = {
  id:string;valuationMetric:"PE_TTM"|"EV_EBITDA_TTM";maxStatementAgeDays:number;
  maxStrongMultiple:number;minWeakMultiple:number;minWeakDebtToEbitda:number;maxWeakCoverage:number;
};
export type CashEvidence = {
  ticker:string;market:"SE"|"US";entityId:string;asOf:string;
  balance?:CashBalance;current?:CashFlow;previous?:CashFlow;policy?:CashPolicy;
  valuation?:{entityId:string;currency:string;period:string;metric:"PE_TTM"|"EV_EBITDA_TTM";multiple:number;asOf:string;priceDataAsOf:string;source:CashSource};
  priceTrend?:{ticker:string;market:"SE"|"US";close:number;sma50:number;sma200:number;dataAsOf:string;observedAt:string;
    instrumentType:"UNDERLYING_EQUITY";source:CashSource};
  report?:{date:string;source:CashSource};
};
export type CashResult = {
  status:"DATA_MISSING"|"WATCH"|"RESEARCH";classification:"CASH STRONG"|"CASH WEAK"|null;
  netCash:number|null;fcf:number|null;previousFcf:number|null;coverage:number|null;previousCoverage:number|null;
  debtToEbitda:number|null;earningsGrowth:number|null;trend:"BULLISH"|"BEARISH"|"NEUTRAL"|"UNKNOWN";
  missing:string[];reasons:string[];demo:boolean;
};
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const positive=(v:unknown):v is number=>finite(v)&&v>0;
const nonnegative=(v:unknown):v is number=>finite(v)&&v>=0;
const text=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const timestamp=(v:unknown):number=>typeof v==="string"&&validMarketDate(v.slice(0,10))&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const days=(start:string,end:string)=>(Date.parse(end)-Date.parse(start))/86400_000+1;
const symbol=(v:string,market:string)=>market==="SE"?v.trim().toUpperCase().replace(/\.ST$/,""):v.trim().toUpperCase();

/** No fetch, storage, imputation, trading score or external verification.
 * A source adapter must establish DOCUMENT_MATCHED before supplying evidence.
 * This validates the supplied contract, never a pasted "verified" checkbox.
 */
export function cashResearch(e?:CashEvidence|null,now=Date.now(),
  context?:{ticker:string;market:string;signalAt?:string;historical?:boolean}):CashResult {
  const r:CashResult={status:"DATA_MISSING",classification:null,netCash:null,fcf:null,previousFcf:null,
    coverage:null,previousCoverage:null,debtToEbitda:null,earningsGrowth:null,trend:"UNKNOWN",
    missing:[],reasons:[],demo:false};
  if(!e){r.missing=["Verifierad balansräkning och jämförbara TTM-kassaflöden saknas."];return r;}
  r.demo=[e.balance?.source,e.current?.source,e.previous?.source,e.valuation?.source,e.priceTrend?.source,e.report?.source]
    .some(s=>s?.kind==="TEST_FIXTURE");
  const cutoff=context?.signalAt?timestamp(context.signalAt):now;
  const observed=timestamp(e.asOf);
  if((context?.historical&&!context.signalAt)||!Number.isFinite(cutoff)||cutoff>now||!Number.isFinite(observed)||observed>cutoff||
    !text(e.entityId)||!text(e.ticker)||!["SE","US"].includes(e.market)||
    (context&&(e.market!==context.market||symbol(e.ticker,e.market)!==symbol(context.ticker,context.market)))){
    r.missing.push("Identitet eller point-in-time saknas/motsägs; senare underlag får inte lånas till äldre signal.");return r;
  }
  const source=(s:CashSource|undefined)=>{
    if(s?.kind==="TEST_FIXTURE")r.demo=true;
    return !!s&&["ISSUER_FILING","EXISTING_VERIFIED_FEED","TEST_FIXTURE"].includes(s.kind)&&
      s.verification==="DOCUMENT_MATCHED"&&text(s.name)&&text(s.documentId)&&
      Number.isFinite(timestamp(s.publishedAt))&&timestamp(s.publishedAt)<=observed;
  };
  const basis=(b:Basis|undefined)=>!!b&&b.entityId===e.entityId&&b.scope==="CONSOLIDATED"&&
    typeof b.currency==="string"&&/^[A-Z]{3}$/.test(b.currency)&&source(b.source);
  const b=e.balance,c=e.current,p=e.previous;
  const balanceOk=basis(b)&&!!b&&validMarketDate(b.period)&&Date.parse(b.period)<=timestamp(b.source.publishedAt)&&
    [b.cash,b.shortTermInvestments,b.interestBearingDebt].every(nonnegative)&&
    (b.leaseLiabilities==null||nonnegative(b.leaseLiabilities))&&
    (b.debtDefinition==="INCLUDING_LEASES"||(b.debtDefinition==="EXCLUDING_LEASES"&&nonnegative(b.leaseLiabilities)));
  if(balanceOk&&b){
    const net=b.cash+b.shortTermInvestments-b.interestBearingDebt-
      (b.debtDefinition==="EXCLUDING_LEASES"?b.leaseLiabilities!:0);
    if(finite(net))r.netCash=net;
  }
  if(r.netCash===null)r.missing.push("Balans: belopp, valuta/period, källa eller leasing/skulddefinition ej verifierad.");
  const flow=(f:CashFlow|undefined)=>basis(f)&&!!f&&f.basis==="TTM"&&
    f.method==="OPERATING_CASH_FLOW_MINUS_CAPEX"&&validMarketDate(f.start)&&validMarketDate(f.end)&&
    days(f.start,f.end)>=365&&days(f.start,f.end)<=366&&
    Date.parse(f.end)<=timestamp(f.source.publishedAt)&&finite(f.operatingCashFlow)&&nonnegative(f.capex);
  const comparable=flow(c)&&flow(p)&&!!c&&!!p&&!!b&&c.currency===b.currency&&p.currency===b.currency&&
    c.end===b.period&&Date.parse(c.start)-Date.parse(p.end)===86400_000;
  if(comparable&&c&&p){
    r.fcf=c.operatingCashFlow-c.capex;r.previousFcf=p.operatingCashFlow-p.capex;
    if(!finite(r.fcf)||!finite(r.previousFcf)){r.fcf=null;r.previousFcf=null;}
    if(finite(c.ebit)&&positive(c.interestExpense))r.coverage=c.ebit/c.interestExpense;
    if(finite(p.ebit)&&positive(p.interestExpense))r.previousCoverage=p.ebit/p.interestExpense;
    if(r.netCash!==null&&r.netCash<0&&positive(c.ebitda))r.debtToEbitda=-r.netCash/c.ebitda;
    if(finite(c.netIncome)&&positive(p.netIncome))r.earningsGrowth=(c.netIncome-p.netIncome)/p.netIncome;
    for(const k of ["coverage","previousCoverage","debtToEbitda","earningsGrowth"] as const)
      if(!finite(r[k]))r[k]=null;
  }
  if(r.fcf===null||r.previousFcf===null)r.missing.push("FCF: CFO/capex, jämförbara TTM-perioder, valuta, scope eller proveniens saknas.");
  if(r.missing.length)return r;
  const policy=e.policy;
  const policyOk=!!policy&&text(policy.id)&&["PE_TTM","EV_EBITDA_TTM"].includes(policy.valuationMetric)&&
    [policy.maxStatementAgeDays,policy.maxStrongMultiple,policy.minWeakMultiple,
      policy.minWeakDebtToEbitda,policy.maxWeakCoverage].every(positive);
  if(!policyOk)r.reasons.push("WATCH – explicita värderings-/skuld-/färskhetsgränser saknas; inga gränser gissas.");
  else if((cutoff-Date.parse(b!.period))/86400_000>policy!.maxStatementAgeDays)
    r.reasons.push("WATCH – balansperioden är äldre än vald policy tillåter.");
  const v=e.valuation;
  if(!v||!source(v.source)||v.entityId!==e.entityId||v.currency!==b!.currency||v.period!==c!.end||
    !positive(v.multiple)||!policyOk||v.metric!==policy!.valuationMetric||
    !Number.isFinite(timestamp(v.asOf))||timestamp(v.asOf)>observed||
    timestamp(v.asOf)<timestamp(v.source.publishedAt)||timestamp(v.asOf)<timestamp(c!.source.publishedAt)||
    v.priceDataAsOf!==previousMarketDay(signalSessionDate(new Date(cutoff),e.market),e.market)||
    signalSessionDate(new Date(timestamp(v.asOf)),e.market)<=v.priceDataAsOf)
    r.reasons.push("WATCH – värdering, mått, källa eller aktuell värderingsdag ej verifierad.");
  const t=e.priceTrend;
  if(t&&source(t.source)&&text(t.ticker)&&t.market===e.market&&symbol(t.ticker,t.market)===symbol(e.ticker,e.market)&&
    ["EXISTING_VERIFIED_FEED","TEST_FIXTURE"].includes(t.source.kind)&&
    t.instrumentType==="UNDERLYING_EQUITY"&&[t.close,t.sma50,t.sma200].every(positive)&&
    t.dataAsOf===previousMarketDay(signalSessionDate(new Date(cutoff),e.market),e.market)&&
    Number.isFinite(timestamp(t.observedAt))&&timestamp(t.observedAt)<=observed&&
    timestamp(t.source.publishedAt)>=Date.parse(t.dataAsOf)&&
    timestamp(t.source.publishedAt)<=timestamp(t.observedAt)&&
    signalSessionDate(new Date(timestamp(t.source.publishedAt)),e.market)>t.dataAsOf&&
    signalSessionDate(new Date(timestamp(t.observedAt)),e.market)>t.dataAsOf){
    r.trend=t.close>t.sma50&&t.sma50>t.sma200?"BULLISH":t.close<t.sma50&&t.sma50<t.sma200?"BEARISH":"NEUTRAL";
  }else r.reasons.push("WATCH – aktiens daterade SMA-pristrend ej verifierad.");
  const report=e.report;
  if(!report||!source(report.source)||reportWindow(report.date,marketDate(new Date(cutoff),e.market),e.market).blocked)
    r.reasons.push("WATCH – rapportdatum ej verifierat eller inom rapportspärren.");
  if(r.earningsGrowth===null)r.reasons.push("WATCH – jämförbar vinstutveckling ej verifierad.");
  if(r.reasons.length){r.status="WATCH";return r;}
  const strong=r.netCash!>0&&r.fcf!>0&&r.fcf!>r.previousFcf!&&r.trend==="BULLISH"&&
    r.earningsGrowth!>0&&v!.multiple<=policy!.maxStrongMultiple;
  const weak=r.netCash!<0&&r.fcf!<0&&r.fcf!<r.previousFcf!&&r.trend==="BEARISH"&&r.earningsGrowth!<0&&
    r.coverage!==null&&r.previousCoverage!==null&&r.coverage<r.previousCoverage&&
    r.coverage<=policy!.maxWeakCoverage&&r.debtToEbitda!==null&&r.debtToEbitda>=policy!.minWeakDebtToEbitda&&
    v!.multiple>=policy!.minWeakMultiple;
  r.status=strong||weak?"RESEARCH":"WATCH";
  r.classification=strong?"CASH STRONG":weak?"CASH WEAK":null;
  if(!r.classification)r.reasons.push("WATCH – samtliga villkor för CASH STRONG/WEAK är inte uppfyllda; se beräkningsunderlaget.");
  return r;
}
