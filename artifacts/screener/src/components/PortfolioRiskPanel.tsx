import React from "react";
import type { PortfolioPosition } from "@workspace/api-client-react";
import { portfolioRisk } from "../lib/portfolioRisk";
import { actualQuoteAge } from "../lib/entrySafety";
const number = (n: number | null) => n == null ? "okänt" : n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
export function PortfolioRiskPanel({ positions, now = Date.now() }: { positions: readonly PortfolioPosition[]; now?: number }) {
  const risk = portfolioRisk(positions);
  const total = (s: { value: number | null; unknown: number }) =>
    `${number(s.value)}${s.unknown ? ` (delsumma; ${s.unknown} okända, total okänd)` : ""}`;
  return <section className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="portfolio-risk">
    <h2 className="font-semibold">Registrerad portföljrisk · inga positionsändringar</h2>
    <p className="text-xs text-amber-700 dark:text-amber-400">Beloppen följer portföljens befintliga kr-modell.
      Prisvaluta/FX och eventuell belåning är inte registrerade/verifierade; faktisk SEK-insats och total kontorisk är därför okända.
      Stop-risk är ett planerat scenario, inte en garanterad maximal förlust.</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div><dt>Registrerat entryvärde</dt><dd className="font-mono">{total(risk.capital)}</dd></div>
      <div><dt>Planerad stop-risk</dt><dd className="font-mono">{total(risk.stop)}</dd></div>
      <div><dt>Känd maximal instrumentförlust*</dt><dd className="font-mono">{total(risk.maximum)}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">*Ägda, fullt betalda long-instrument kan förlora hela entryvärdet.
      SHORT i själva instrumentet kan ha obegränsad förlust. Kostnader/belåning ingår inte; hävstång multipliceras aldrig in.</p>
    {risk.banks >= 2 && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
      Koncentrerad sektorexponering: {risk.banks} positioner med underliggande C/Citi eller BAC/Bank of America, amerikanska banker.
      Gemensam sektorrisk; faktisk korrelation, nettning och underliggande notional är okända.</p>}
    <p className="text-xs text-muted-foreground">Manuell sektorreferens endast för registrerat underliggande/ticker C/BAC; kontrollera identiteten.
      Sektor för {risk.unknownSector} övriga positioner okänd.
      Inga korrelationstal uppskattas.</p>
    <div className="grid gap-2 sm:grid-cols-2">{risk.rows.map(r => <article key={r.id} className="rounded border border-border p-2 text-xs break-words">
      <strong>{r.ticker}</strong> · {r.product ? "produkt" : "aktie/registrerad position"} · instrumentsida {r.side ?? "okänd"}
      <p>Entryvärde {number(r.capital)} · stop-risk {number(r.stop)} · maximal instrumentförlust {r.unbounded ? "potentiellt obegränsad" : number(r.maximum)}</p>
      <p>Hävstång {number(r.leverage)} · barriär {number(r.barrier)}. Inget av dessa tal används för att förstora P&amp;L.</p>
      <p>Kurs asOf {positions.find(p => p.id === r.id)?.quoteAsOf ?? "okänd"} · ålder {
        actualQuoteAge({ asOf: positions.find(p => p.id === r.id)?.quoteAsOf }, now) == null ? "okänd" :
          `${actualQuoteAge({ asOf: positions.find(p => p.id === r.id)?.quoteAsOf }, now)} min`}.
        {" "}Ingen live-entryverifiering av positioner görs här.</p>
      <p className="text-amber-700 dark:text-amber-400">{r.product ? "Knockout/full kapitalförlust kan avvika från stop-risk. Barriärens enhet/underliggande måste kontrolleras." : "Ingen knockoutnivå antas."}
        {" "}Helg-/kursgap och spread kan passera stop; faktisk gapförlust okänd.</p>
    </article>)}</div>
    {!positions.length && <p className="text-xs text-muted-foreground">Inga registrerade positioner. Inga nya positioner skapas.</p>}
  </section>;
}
