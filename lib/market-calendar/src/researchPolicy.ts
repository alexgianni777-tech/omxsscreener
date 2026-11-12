import { marketDate, observedReportDate, previousMarketDay, reportWindow, signalSessionDate } from "./index.js";

export type Qualification = { status: "QUALIFIED" | "WATCH" | "RESEARCH" | "BLOCKED"; reasons: string[] };
export type Regime = { state: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN"; source: string|null; dataDate: string|null };
export type SourceReport = { status?:string; marketContext?:unknown; dataDates?:unknown };
export type ResearchEvidence = {
  ticker?:string; category?:string; direction?:string; signalSource?:string|null; market?:string|null;
  signalDate?:string|null; dataDate?:string|null; volumeAsOf?:string|null; dataQuality?:unknown;
  atr?:number|null; rsi?:number|null; signalRsi?:number|null; perf1m?:number; rs3m?:number;
  volMultiplier?:number; earningsInDays?:number|null; earningsKnowledge?:string|null;
  review?:{status:string;reasons:string[]}; entryPrice?:number;stopPrice?:number;targetPrice?:number;
};
const object=(v:unknown):Record<string,unknown> => v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>0;
const symbol=(s:unknown)=>typeof s==="string"?s.trim().toUpperCase().replace(/\.ST$/,"").replace(/\s+/g,"-"):"";
export function evidenceDataDate(e:ResearchEvidence):string|null {
  if(e.dataDate!==undefined)return e.dataDate;
  const q=object(e.dataQuality);
  if(Object.hasOwn(q,"dataAsOf"))return typeof q.dataAsOf==="string"?q.dataAsOf:null;
  return e.volumeAsOf??null;
}
export type AtrEvidence={value:number;source:string;market:string;ticker:string;dataAsOf:string;period:number;instrumentType:"UNDERLYING_EQUITY";unit:"PRICE";timeframe:"1d";method:"WILDER"|"SIMPLE"};
/** Never reinterpret win rate, expectancy, a product ATR or an unbound number as equity ATR. */
export function verifiedUnderlyingAtr(raw:unknown,ticker:unknown,market:unknown,dataDate:unknown):AtrEvidence|null {
  const p=object(raw);
  if(!positive(p.value)||typeof p.source!=="string"||!p.source.trim()||
    !["SE","US"].includes(String(market))||p.market!==market||!symbol(ticker)||symbol(p.ticker)!==symbol(ticker)||
    typeof dataDate!=="string"||p.dataAsOf!==dataDate||!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)||
    !Number.isFinite(Date.parse(dataDate))||new Date(dataDate).toISOString().slice(0,10)!==dataDate||
    !Number.isInteger(p.period)||!positive(p.period)||p.instrumentType!=="UNDERLYING_EQUITY"||
    p.unit!=="PRICE"||p.timeframe!=="1d"||!["WILDER","SIMPLE"].includes(String(p.method)))return null;
  return {...p,source:p.source.trim()} as AtrEvidence;
}
export function hasVerifiedAtr(e:ResearchEvidence):boolean {
  if(e.signalSource!=="edgeai")return positive(e.atr);
  const p=verifiedUnderlyingAtr(object(e.dataQuality).atrEvidence,e.ticker,e.market,evidenceDataDate(e));
  return !!p&&positive(e.atr)&&e.atr===p.value;
}
export function marketRegime(reports:readonly SourceReport[],market:string,dataDate:string|null,now=new Date()):Regime {
  const unknown:Regime={state:"UNKNOWN",source:null,dataDate};
  if(!dataDate||(market!=="SE"&&market!=="US"))return unknown;
  const snapshots=reports.filter(r=>r?.status==="SUCCESS").flatMap(r=>{
    const s=object(object(r.marketContext)[market]),i=object(s.indexSnapshot);
    if(s.dataAsOf!==dataDate||object(r.dataDates)[market]!==dataDate||
      !positive(i.close)||!positive(i.sma50)||!positive(i.sma200)||typeof i.source!=="string"||!i.source.trim()||
      typeof i.asOf!=="string"||!Number.isFinite(Date.parse(i.asOf))||Date.parse(i.asOf)>now.getTime()||
      marketDate(new Date(i.asOf),market)!==dataDate||signalSessionDate(new Date(i.asOf),market)<=dataDate)return [];
    return [{close:i.close,sma50:i.sma50,sma200:i.sma200,source:i.source}];
  });
  const f=snapshots[0];
  if(!f||snapshots.some(s=>s.close!==f.close||s.sma50!==f.sma50||s.sma200!==f.sma200))return unknown;
  return {source:f.source,dataDate,state:f.close>f.sma50&&f.sma50>f.sma200?"BULLISH":
    f.close<f.sma50&&f.sma50<f.sma200?"BEARISH":"NEUTRAL"};
}
export function qualifyResearch(e:ResearchEvidence,regime:Regime={state:"UNKNOWN",source:null,dataDate:null},now=new Date()):Qualification {
  const blocked:string[]=[],watch:string[]=[],isEdge=e.signalSource==="edgeai";
  const dataDate=evidenceDataDate(e),market=e.market==="US"?"US":"SE";
  if(!["telegram","edgeai","manual","screener"].includes(e.signalSource??""))blocked.push("UNKNOWN_SOURCE");
  if(!["MOMENTUM","SQUEEZE","STUDS","WEAKEST","SVAGAST"].includes(e.category??""))watch.push("Okänd modul – ingen automatisk kvalificering.");
  if(!["SE","US"].includes(e.market??"")||!dataDate||dataDate!==previousMarketDay(signalSessionDate(now,market),market))
    blocked.push("STALE/UNKNOWN_DATA_DATE – verifierad senaste avslutade marknadsdag krävs.");
  if(!["LONG","SHORT"].includes(e.direction??""))blocked.push("UNKNOWN_DIRECTION");
  const rr=Math.abs(e.targetPrice!-e.entryPrice!)/Math.abs(e.entryPrice!-e.stopPrice!);
  if(![e.entryPrice,e.stopPrice,e.targetPrice].every(positive)||!Number.isFinite(rr)||rr<1.2||
    (e.direction==="LONG"?!(e.stopPrice!<e.entryPrice!&&e.entryPrice!<e.targetPrice!):!(e.targetPrice!<e.entryPrice!&&e.entryPrice!<e.stopPrice!)))
    blocked.push("INVALID_PLAN – verifierad entry/stop/target och brutto-R/R ≥ 1,2 krävs.");
  if(e.review?.status==="BLOCKED")blocked.push(...e.review.reasons);
  else if(e.review?.status==="WARN")watch.push(...e.review.reasons);
  const report=reportWindow(observedReportDate(e.signalDate,e.earningsInDays,e.earningsKnowledge),marketDate(now,market),e.market??"");
  if(report.blocked)blocked.push(`${report.status} – rapportkontroll krävs före kvalificering.`);
  if(!positive(e.volMultiplier))blocked.push("Volymdata saknas/är ogiltig.");
  if(![e.perf1m,e.rs3m].every(n=>typeof n==="number"&&Number.isFinite(n)))blocked.push("Trendserien saknar ändliga perf1m/rs3m-värden.");
  const rsi=isEdge?e.signalRsi:e.rsi;
  if(rsi==null||!Number.isFinite(rsi)||rsi<0||rsi>100)watch.push("RSI ej verifierad.");
  if(!hasVerifiedAtr(e))watch.push("ATR för underliggande ej verifierad; edge-statistik ersätter inte ATR.");
  if(!isEdge&&e.category==="MOMENTUM"&&e.direction==="LONG"&&((e.perf1m??0)<=0||(e.rs3m??0)<=0))
    blocked.push("Momentum saknar positiv utveckling/relativ styrka.");
  const q=object(e.dataQuality);
  if(isEdge&&(q.entryEligible!==true||q.eliteQualified!==true||q.validatedEdge!==true||
    !["VALIDATED","ELITE","QUALIFIED"].includes(String(q.evidenceStatus))||
    !["ELITE","QUALIFIED","QUALIFIED_OOS"].includes(String(q.eliteStatus))))
    watch.push("Upstream-kvalificering ej verifierad.");
  if(regime.state==="UNKNOWN"||regime.dataDate!==dataDate||!regime.source)watch.push("SMA50/SMA200-marknadsregim saknar verifierat underlag.");
  else if(regime.state==="NEUTRAL"||(e.direction==="LONG"&&regime.state==="BEARISH")||(e.direction==="SHORT"&&regime.state==="BULLISH"))
    watch.push("Motstridig/neutral marknadsregim – endast WATCH.");
  const research=["STUDS","WEAKEST","SVAGAST"].includes(e.category??"");
  return {status:blocked.length?"BLOCKED":research?"RESEARCH":watch.length?"WATCH":"QUALIFIED",
    reasons:[...new Set([...blocked,...watch,...(research?["RESEARCH – oberoende netto-positiv expectancy är inte verifierad för modulen."]:[])])]};
}
export const BOARD_REVIEW_REQUIRED="BOARD REVIEW REQUIRED";
export const BOARD_PERSPECTIVES=[
  ["Atlas strategi","Tes, entry, mål och tidshorisont"],
  ["Eleanor risk","Aktiestop, högst 20 % insats/4 % planerad förlust, gaprisk och portföljkorrelation"],
  ["Victor data","Källa, datadag, ATR-proveniens och rapportstatus"],
  ["Harper marknad","Marknadsregim, FOMO-kontroll och korrelation"],
  ["Eric exekvering","Aktuell aktiekurs, kostnader och netto-R/R om verifierbart"],
] as const;
/** A chat excerpt is human documentation, not cryptographic proof or an AI signature.
 * No code path in this app grants order approval from this self-reported record.
 */
export function boardArchive(context:string,chatReference:string,notes:readonly string[],recordedAt:string) {
  const values=[context,chatReference,...notes];
  if(values.some(v=>v.length>8000)||/(github_pat_|gh[pousr]_[a-z0-9]{12}|bearer\s+\S+|-----BEGIN.*PRIVATE KEY|(?:password|api[_ -]?key|secret|authorization|cookie|session[_ -]?(?:id|token))\s*[:=])/i.test(values.join("\n")))
    throw new Error("Protokollet får inte innehålla autentiseringsuppgifter eller för långa fält.");
  const complete=!!context.trim()&&!!chatReference.trim()&&notes.length===5&&notes.every(n=>!!n.trim());
  return `${BOARD_REVIEW_REQUIRED}\nUNDERLIGGANDE AKTIER – INGA ORDRAR\n${recordedAt}\n`+
    `${complete?"Manuell dokumentation ifylld; inte verifierat ordergodkännande.":"UTKAST – ofullständig granskning."}\n`+
    `Underlag: ${context}\nChattreferens/datum: ${chatReference}\n`+
    BOARD_PERSPECTIVES.map(([role,prompt],i)=>`\n${role}: ${prompt}\n${notes[i]??""}`).join("\n")+
    "\n\nInga AI-signaturer. Saknat risk-/rapport-/kostnadsunderlag förblir ej verifierat. Ingen automatisk entry eller order.";
}
