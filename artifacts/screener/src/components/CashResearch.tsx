import React from "react";
import { cashResearch, type CashEvidence, type CashResult, type CashSource } from "../lib/cashResearch";

const value=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)
  ?v.toLocaleString("sv-SE",{maximumFractionDigits:2})
  :typeof v==="string"&&v.trim()?v:"saknas / ej verifierat";
const source=(s:CashSource|undefined)=>s
  ?`${value(s.name)} · ${value(s.documentId)} · publicerat ${value(s.publishedAt)} · ${value(s.kind)} / ${value(s.verification)}`
  :"saknas / ej verifierad";
export type CashResearchEntry={ticker:string;market:string;evidence?:CashEvidence};

export function CashResearch({ticker,market="",evidence,now=Date.now(),signalAt,historical=false}:{
  ticker:string;market?:string;evidence?:CashEvidence;now?:number;signalAt?:string;historical?:boolean;
}) {
  const result=cashResearch(evidence,now,{ticker,market,signalAt,historical});
  const b=evidence?.balance,c=evidence?.current,p=evidence?.previous,policy=evidence?.policy;
  const fields:[string,unknown][]=[
    ["Valuta / scope",b?`${value(b.currency)} / ${value(b.scope)}`:null],["Balansperiod",b?.period],
    ["Cash",b?.cash],["Korta likvida placeringar",b?.shortTermInvestments],
    ["Räntebärande skuld",b?.interestBearingDebt],["Leasingskuld",b?.leaseLiabilities],
    ["Skulddefinition",b?.debtDefinition],["Nettokassa, beräknad",result.netCash],
    ["TTM nu",c?`${value(c.start)} – ${value(c.end)}`:null],
    ["TTM jämförelse",p?`${value(p.start)} – ${value(p.end)}`:null],
    ["CFO nu / tidigare",c&&p?`${value(c.operatingCashFlow)} / ${value(p.operatingCashFlow)}`:null],
    ["Capex nu / tidigare",c&&p?`${value(c.capex)} / ${value(p.capex)}`:null],
    ["FCF nu / tidigare",`${value(result.fcf)} / ${value(result.previousFcf)}`],
    ["FCF-definition",c?.method],["Vinst nu / tidigare",c&&p?`${value(c.netIncome)} / ${value(p.netIncome)}`:null],
    ["EBIT nu / tidigare",c&&p?`${value(c.ebit)} / ${value(p.ebit)}`:null],
    ["Räntekostnad nu / tidigare",c&&p?`${value(c.interestExpense)} / ${value(p.interestExpense)}`:null],
    ["Interest coverage nu / tidigare",`${value(result.coverage)} / ${value(result.previousCoverage)}`],
    ["EBITDA nu",c?.ebitda],["Nettoskuld / EBITDA",result.debtToEbitda],
    ["Värderingsmått / multipel",evidence?.valuation?`${evidence.valuation.metric} / ${value(evidence.valuation.multiple)}`:null],
    ["Värderingens as-of",evidence?.valuation?.asOf],["Värderingskursens datadag",evidence?.valuation?.priceDataAsOf],
    ["Pristrend / datadag",`${result.trend} / ${value(evidence?.priceTrend?.dataAsOf)}`],
    ["Aktiekurs / SMA50 / SMA200",evidence?.priceTrend
      ?`${value(evidence.priceTrend.close)} / ${value(evidence.priceTrend.sma50)} / ${value(evidence.priceTrend.sma200)}`:null],
    ["Rapportdatum",evidence?.report?.date],["Underlag observerat as-of",evidence?.asOf],
  ];
  return <details className="mt-3 min-w-0 rounded border border-border p-2 text-xs" data-testid="cash-research">
    <summary className="cursor-pointer">CASH STRONG/WEAK · {ticker} · {result.classification??result.status}{result.demo?" · DEMO":""}</summary>
    <p className="mt-2">Separat fundamentalsforskning, aldrig QUALIFIED eller entrygodkännande.
      Nettokassa = cash + korta likvida placeringar − räntebärande skuld inklusive verifierad leasing.</p>
    {result.demo&&<p className="mt-1 font-semibold">DEMO / TESTDATA – inga verkliga finansuppgifter.</p>}
    {historical&&<p>Historiskt signalunderlag får inte uppgraderas med senare uppgifter. Exakt beslutstid krävs för efterhandsbedömning.</p>}
    {[...result.missing,...result.reasons].map(reason=><p key={reason} className="mt-1">{reason}</p>)}
    {!evidence?<p className="mt-1">Ingen verifierad fundamentalskälla är ansluten till denna bedömning.
      EdgeAI:s edgepoäng är inte balansräkningsdata. Inga belopp fylls med noll och ingen ny hämtning startas.</p>
      :<>
        <p className="mt-1">Tillhandahållna råuppgifter nedan; källdokument har inte hämtats eller externt verifierats av denna vy.
          Klassning: {result.status}. Ofullständiga uppgifter är inte ett godkännande.</p>
        <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {fields.map(([label,v])=><div key={label} className="min-w-0 break-words">
            <dt className="text-muted-foreground">{label}</dt><dd className="font-mono tabular-nums">{value(v)}</dd>
          </div>)}
        </dl>
        <div className="mt-2 space-y-1 break-words">
          <p>Balanskälla: {source(b?.source)}</p><p>FCF-källa nu: {source(c?.source)}</p>
          <p>FCF-källa jämförelse: {source(p?.source)}</p><p>Värderingskälla: {source(evidence.valuation?.source)}</p>
          <p>Pristrendkälla: {source(evidence.priceTrend?.source)}</p><p>Rapportkälla: {source(evidence.report?.source)}</p>
          <p>Policy {value(policy?.id)}: STRONG multipel ≤ {value(policy?.maxStrongMultiple)};
            WEAK multipel ≥ {value(policy?.minWeakMultiple)}, nettoskuld/EBITDA ≥ {value(policy?.minWeakDebtToEbitda)},
            coverage ≤ {value(policy?.maxWeakCoverage)}. Max balansålder {value(policy?.maxStatementAgeDays)} dagar.</p>
        </div>
      </>}
    <p className="mt-2">FCF = operativt kassaflöde − capex, två jämförbara TTM-år.
      Kända råvärden är inte bevisad edge. Befintliga rapport-, live-entry- och riskspärrar påverkas inte.</p>
  </details>;
}

/** Stable research groups, not a cross-currency numerical score or Top 3 replacement. */
export function cashResearchRanking(entries:readonly CashResearchEntry[],now=Date.now()) {
  return entries.map(entry=>({...entry,result:cashResearch(entry.evidence,now,{ticker:entry.ticker,market:entry.market})}))
    .sort((a,b)=>{
      const rank=(r:CashResult)=>r.classification==="CASH STRONG"?0:r.classification==="CASH WEAK"?1:r.status==="WATCH"?2:3;
      return rank(a.result)-rank(b.result)||`${a.market}:${a.ticker}`.localeCompare(`${b.market}:${b.ticker}`);
    });
}
export function CashResearchRanking({entries,now=Date.now()}:{entries:readonly CashResearchEntry[];now?:number}) {
  const rows=cashResearchRanking(entries,now);
  return <details className="mt-4 min-w-0 border-t border-border pt-3 text-xs" data-testid="cash-research-ranking">
    <summary className="cursor-pointer font-medium">CASH · separat forskningslista ({rows.length} instrument)</summary>
    <p className="mt-2">Grupperad klassning, inte en köp-/säljranking. Ingen jämförelse av absoluta belopp mellan valutor eller bolagsstorlekar.
      Aktuell forskning ändrar aldrig gamla signaler, Top 3 eller handelsbeslut.</p>
    {(["CASH STRONG","CASH WEAK","WATCH / DATA_MISSING"] as const).map(group=>{
      const matching=rows.filter(row=>group==="WATCH / DATA_MISSING"?!row.result.classification:row.result.classification===group);
      return <div key={group} className="mt-3 min-w-0">
        <h3 className="font-semibold">{group} · {matching.length}</h3>
        {!matching.length?<p className="text-muted-foreground">Inga case med styrkt underlag i denna grupp.</p>
          :matching.map(row=><CashResearch key={`${row.market}:${row.ticker}`} {...row} now={now}/>)}
      </div>;
    })}
    {!rows.length&&<p className="mt-2">Inga instrument att bedöma. Inga case eller balansvärden skapas automatiskt.</p>}
  </details>;
}
