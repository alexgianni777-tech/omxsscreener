import React from "react";
import { cashResearch, type CashEvidence } from "../lib/cashResearch";
export function CashResearch({ticker,evidence}:{ticker:string;evidence?:CashEvidence}) {
  const result=cashResearch(evidence);
  return <details className="mt-3 rounded border border-border p-2 text-xs" data-testid="cash-research">
    <summary className="cursor-pointer">CASH STRONG/WEAK · {ticker} · {result.status}</summary>
    <p>Separat fundamentalsforskning, inte entrygodkännande. Nettokassa = cash + korta likvida placeringar − räntebärande skulder.</p>
    {result.netCash==null?<p>Verifierbart finansunderlag saknas. Komplettera likvida medel, korta placeringar, skulder, FCF/jämförelseperiod,
      interest coverage, earnings/värdering och trend. Samma valuta och jämförbara perioder krävs, med publiceringsdatum, källa och as-of.
      Leasing/skulddefinition måste kontrolleras. Inga nollor eller uppskattade balansräkningar används.</p>
      :<p>{result.classification??"Ingen tydlig CASH-klass"} · nettokassa {result.netCash.toLocaleString("sv-SE")} {evidence?.currency} ·
        FCF {evidence?.fcf} · period {evidence?.period} · {evidence?.source} · as-of {evidence?.asOf}</p>}
    <p>As-of äldre än 120 dagar underkänns av datakvalitetspolicyn. Rapportspärr och övriga riskregler gäller även här.
      Ingen ny finansdatainhämtning har startats.</p>
  </details>;
}
