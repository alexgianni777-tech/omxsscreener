import React from "react";
import { Link } from "wouter";
import { useGetLastValidTop3, getGetLastValidTop3QueryKey, type SavedTop3Display } from "@workspace/api-client-react";
import { stockholmToday } from "../lib/persistentTop3Display";
import { previousWeekday } from "../lib/dailyCandidates";

export function SavedTop3Content({ selection: s, today }: { selection: SavedTop3Display; today: string }) {
  const stale = s.date !== today || s.dataDates.some(d => !d.dataDate || d.dataDate !== previousWeekday(today));
  return <>
    <h3 className="text-sm font-semibold flex flex-wrap items-center gap-2">Senast giltiga sparade Top 3
      <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">{s.kind === "OFFICIAL" ? "officiellt fryst urval" : `rekommendation v${s.revision.revision}`}</span></h3>
    <p className="mt-1 text-xs text-muted-foreground">Session {s.date} · Sparat {new Date(s.revision.selectedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}</p>
    <p className={`mt-1 text-xs font-medium ${stale ? "text-amber-600" : "text-muted-foreground"}`}>
      {stale ? "STALE / ej nytt köp utan liveverifiering." : "Sparad screening — inte ett live-entrybesked."}
      {" "}Kontrollera aktuell kurs, faktisk kurstidpunkt och rapportkalender före eget beslut.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {(["SE", "US"] as const).flatMap(market => (["LONG", "SHORT"] as const).map(direction => {
        const picks = s.revision.picks.filter(p => p.market === market && p.direction === direction);
        return picks.length ? <section key={`${market}-${direction}`} className="rounded-md border border-border bg-background/60 p-2.5 min-w-0">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{market === "SE" ? "Sverige" : "USA"} · {direction === "LONG" ? "Long" : "Short"}</h4>
          {picks.map(p => {
            const date = s.dataDates.find(d => d.source === p.source && d.signalDate === p.signalDate);
            return <p key={p.candidateId} className="mt-1 text-xs">
              <strong>{p.ticker}</strong> · {p.source ?? "okänd källa"} · rapport/signal {p.signalDate ?? "okänd"} · datadag {date?.dataDate ?? "okänd"}
              <br /><span className="font-mono text-[11px] break-words">Entry {p.entryPrice} · Stop {p.stopPrice} · TP {p.targetPrice} · R/R {p.rr.toFixed(2)}</span>
            </p>;
          })}
        </section> : null;
      }))}
    </div>
    <Link href={`/sessions/${s.sessionId}`} className="mt-3 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">
      Visa fryst officiellt urval, rekommendationsversioner, live-kandidater och historiska utfall
    </Link>
  </>;
}
export function SavedTop3() {
  const query = useGetLastValidTop3({ query: { queryKey: getGetLastValidTop3QueryKey(), retry: false } });
  return <section className="rounded-lg border border-primary/25 bg-card p-3 sm:p-4 shadow-sm" aria-busy={query.isLoading} data-testid="saved-top3">
    {query.data?.selection ? <SavedTop3Content selection={query.data.selection} today={stockholmToday()} />
      : <p className="text-sm">{query.isLoading ? "Läser senast giltiga sparade Top 3…" : "Ingen giltig sparad Top 3 hittades. Inga picks gissas."}</p>}
    {query.isError && <p role="alert" className="mt-2 text-xs text-amber-600">Senaste status kunde inte hämtas. Sparat urval ändras inte.
      {" "}<button onClick={() => query.refetch()} className="underline" data-testid="button-retry-saved-top3">Försök igen</button></p>}
    {query.data?.warnings.map(w => <p key={w} role="status" className="mt-2 text-xs text-amber-600">{w}</p>)}
  </section>;
}
