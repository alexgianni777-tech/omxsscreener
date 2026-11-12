import React from "react";
import type { JournalRecord } from "@workspace/api-client-react";
import { journalAnalysis } from "../lib/journalAnalysis";
const fmt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "okänt" : n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
const reasons:Record<string,string>={
  EXECUTION_NOT_VERIFIED:"Fill/exit, tid, antal eller FX ej verifierade",COSTS_NOT_VERIFIED:"Kostnader okända eller ogiltiga",
  INVALID_STOP_OR_RISK:"Initial stop/risk ogiltig",NET_PNL_MISMATCH:"Netto-P&L motsäger underlaget",
  RISK_MISMATCH:"Lagrad risk motsäger faktisk fill/stop",NET_R_MISMATCH:"Lagrad netto-R motsäger underlaget",
};
export function JournalAnalysis({ records, now }: { records: readonly JournalRecord[]; now?: number }) {
  const analysis = journalAnalysis(records, now);
  return <section className="mt-3 space-y-3 rounded border border-border p-3" data-testid="journal-analysis">
    <h3 className="text-sm font-semibold">Exekveringsanalys · verkligt underlag</h3>
    <p className="text-xs text-muted-foreground">{analysis.real} verkliga journalposter · {analysis.sample} verifierade avslut med netto-R · {analysis.excluded} exkluderade p.g.a. saknat/inkonsekvent underlag.
      {" "}{analysis.simulated} simulerade och {analysis.notTaken} uteblivna räknas inte som verkliga affärer.
      Äldre signal-/Challenge-utfall blir inte automatiskt verkliga exekveringar och dubbleras inte här.</p>
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div><dt>Win rate (netto-R, n={analysis.sample})</dt><dd>{analysis.winRate == null ? "okänt" : `${fmt(analysis.winRate * 100)} %`}</dd></div>
      <div><dt>Genomsnittlig vinst-R</dt><dd>{fmt(analysis.winR)}</dd></div>
      <div><dt>Genomsnittlig förlust-R</dt><dd>{fmt(analysis.lossR)}</dd></div>
      <div><dt>Payoff-ratio</dt><dd>{fmt(analysis.payoff)}</dd></div>
    </dl>
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div><dt>Netto expectancy</dt><dd>{fmt(analysis.net.netExpectancy)} R</dd></div>
      <div><dt>Profit Factor</dt><dd>{fmt(analysis.net.profitFactor)} · {analysis.net.profitFactorStatus}</dd></div>
      <div><dt>Max drawdown</dt><dd>{fmt(analysis.net.maxDrawdownR)} R · {analysis.net.drawdownStatus}</dd></div>
      <div><dt>Evidens (n={analysis.net.n})</dt><dd>{analysis.net.status}</dd></div>
    </dl>
    <p className="text-xs">Payoff: {analysis.net.payoffStatus}. Verifiering avser beräkningskonsistens i manuellt journalförda fills,
      inte oberoende avstämning mot mäklare eller backtest. Lika exittider med blandade utfall ger okänd drawdown.</p>
    {!!analysis.exclusions.length&&<details><summary className="cursor-pointer text-xs">Varför verkliga avslut exkluderats</summary>
      {analysis.exclusions.map(item=><p key={item.reason} className="text-xs">{reasons[item.reason]??item.reason}: {item.count}</p>)}
      <p className="text-xs">En post kan ha flera orsaker. Okänd separat spread/slippage ersätts inte med noll;
        faktiska fills omfattar dessa priseffekter och de dras inte av igen.</p>
    </details>}
    <details><summary className="cursor-pointer text-xs">Nettoanalys per källa, modul, riktning och regim</summary>
      <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">{(["source","module","direction","regime"] as const).map(dimension=>
        <section key={dimension} className="min-w-0 text-xs break-words"><h4 className="font-semibold">
          {{source:"Källa",module:"Modul",direction:"Signalriktning",regime:"Historisk regim"}[dimension]}</h4>
          {!analysis.dimensions[dimension].length&&<p>NOT_VERIFIED – inga verifierade avslut.</p>}
          {analysis.dimensions[dimension].map(group=><p key={group.key} className="mt-1">
            {group.key==="WEAKEST"?"SVAGAST":group.key} · n={group.n} · {group.status}<br/>
            Netto E[R] {fmt(group.netExpectancy)} · win rate {group.winRate==null?"okänd":`${fmt(group.winRate*100)} %`} ·
            payoff {fmt(group.payoff)} · PF {fmt(group.profitFactor)} · DD {fmt(group.maxDrawdownR)} R
            {group.drawdownStatus==="AMBIGUOUS_EXIT_ORDER"?" · exitordning ej verifierad":""}
          </p>)}
        </section>)}</div>
    </details>
    <details><summary className="cursor-pointer text-xs">Källa / modul / signalriktning / historisk regim</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{analysis.groups.map(g=><article key={g.key} className="min-w-0 rounded border p-2 text-xs break-words">
        <strong>{g.key}</strong><p>n={g.n} · {g.status}</p>
        <p>Netto E[R] {fmt(g.netExpectancy)} · win rate {g.winRate==null?"okänd":`${fmt(g.winRate*100)} %`} · payoff {fmt(g.payoff)}</p>
        <p>Profit Factor {fmt(g.profitFactor)} · max drawdown {fmt(g.maxDrawdownR)} R</p>
      </article>)}</div>
      <p className="text-xs">Regim UNKNOWN: historisk SMA-regim lagras inte i befintliga journalposter.
        Under 20 avslut markeras INSUFFICIENT_DATA; 20 är en visningsgräns, inte statistiskt bevis för edge.
        Profit Factor utan förlustobservationer är okänd. Importerad EdgeAI-statistik är inte lokalt verifierad journalanalys.</p>
    </details>
    <p className="text-xs text-amber-700 dark:text-amber-400">Små urval och saknade kostnader ger osäker statistik, inte bevisad edge.
      Win rate inkluderar nollresultat i nämnaren; payoff kräver både vinst och förlust.
      MFE/MAE: ej tillgängligt — faktiska high/low-tidsserier under affären saknas.</p>
    <details><summary className="cursor-pointer text-xs">Per-trade underlag och datakvalitet ({records.length})</summary>
      <div className="mt-2 grid gap-2 md:grid-cols-2">{analysis.rows.map(r => {
        const i = r.record.input;
        return <article key={r.record.id} className="rounded border border-border p-2 text-xs break-words">
          <strong>{r.record.signal.ticker} · {i.mode}</strong> · {i.instrumentKind ?? "typ okänd"} · {i.side ?? "sida okänd"}
          <p>Entry {i.entryTime ?? "okänd"} · fill {fmt(i.fillPrice)} · stop {fmt(i.stopPrice)} · mål {fmt(i.targetPrice)}</p>
          <p>Exit {i.exitTime ?? "okänd"} · exitpris {fmt(i.exitPrice)} · antal {fmt(i.quantity)} · prisvaluta {i.priceCurrency ?? "okänd"}</p>
           <p>Brutto-P&amp;L {fmt(r.grossPnl)} SEK · netto-P&amp;L {fmt(r.netPnl)} SEK · netto-R {fmt(r.netR)} · {r.verification}</p>
          <p>Spread {fmt(i.spreadCostKr)} · slippage {fmt(i.slippageCostKr)} · finansiering {fmt(i.financingCostKr)} · courtage {fmt(i.commissionKr)} SEK.</p>
          <p>Brutto beräknas från faktiska fills/antal/FX. Spread/slippage i fills dras inte av igen. Hävstång {fmt(i.leverage)} används inte som P&amp;L-multiplikator.</p>
          <p>MFE/MAE: ej tillgängligt; inga uppskattningar ur slutkurs.</p>
          {r.issues.map(s => <p key={s} className="text-amber-700 dark:text-amber-400">{s}</p>)}
        </article>;
      })}</div>
    </details>
    {!records.length && <p className="text-xs">Ingen exekveringsjournal finns. Historiska signalresultat används inte som ersättning; journalen är frivillig.</p>}
  </section>;
}
