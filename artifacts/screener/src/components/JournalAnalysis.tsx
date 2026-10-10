import React from "react";
import type { JournalRecord } from "@workspace/api-client-react";
import { journalAnalysis } from "../lib/journalAnalysis";
const fmt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "okänt" : n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
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
          <p>Brutto-P&amp;L {fmt(r.grossPnl)} SEK · netto-P&amp;L {fmt(r.netPnl)} SEK · netto-R {fmt(r.netR)}</p>
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
