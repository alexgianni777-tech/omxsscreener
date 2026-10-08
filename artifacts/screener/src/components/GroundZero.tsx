import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetGroundZero, useCreateGroundZeroSnapshot, getGetGroundZeroQueryKey, type GroundZeroState } from "@workspace/api-client-react";

const sek = (n: number) => n.toLocaleString("sv-SE", { style: "currency", currency: "SEK", minimumFractionDigits: 2 });
export const manualSek = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."));
export function GroundZeroResult({ data }: { data: GroundZeroState }) {
  const v = data.latest;
  return <div data-testid="ground-zero-result" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
    <strong>{data.label} · {data.baseDate}</strong>
    <span>Startbas {sek(data.baselineSek)}</span>
    <span>Manuellt totalvärde {v ? `${sek(v.totalValueSek)} · ${v.asOfDate}` : "ej inmatat"}</span>
    <span>Flödesjusterad utveckling {v?.adjustedChangeSek != null
      ? `${sek(v.adjustedChangeSek)} (${v.adjustedChangePct?.toLocaleString("sv-SE")} %)` : "okänd — ingen avstämd värdering/kapitalflöden"}</span>
    <span>Kvar till mål {v ? sek(v.remainingToGoalSek) : "okänt"}</span>
    <span>Mål {sek(data.goalSek)} · senast {data.targetDate}</span>
  </div>;
}
export function GroundZero() {
  const query = useGetGroundZero({ query: { queryKey: getGetGroundZeroQueryKey(), retry: false, refetchOnWindowFocus: false } });
  const client = useQueryClient();
  const save = useCreateGroundZeroSnapshot({ mutation: {
    onSuccess: (data) => {
      client.setQueryData(getGetGroundZeroQueryKey(), data);
      setValue(""); setMessage("Avstämning sparad. Tidigare värden och trades är oförändrade.");
    },
  } });
  const [value, setValue] = useState("");
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date()));
  const [flowsKnown, setFlowsKnown] = useState(false);
  const [flows, setFlows] = useState("0");
  const [message, setMessage] = useState("");
  if (query.isLoading) return <p className="text-xs text-muted-foreground">Ground Zero: läser frivillig avstämning…</p>;
  if (!query.data) return <p role="alert" className="text-xs text-muted-foreground">Ground Zero kunde inte läsas. Kandidater och tradinghistorik påverkas inte.
    {" "}<button onClick={() => query.refetch()} className="underline">Försök igen</button></p>;
  const data = query.data;
  return <section className="rounded-md border border-border bg-muted/20 p-3 text-muted-foreground" data-testid="ground-zero">
    <GroundZeroResult data={data} />
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer">Frivillig avstämning och kapitalflöden</summary>
      <p className="mt-2">Vald startbas {sek(data.baselineSek)}. Separat observerat Avanza-värde {sek(data.observedStartSek)} vid starttillfället.
        Avstämningsdifferens {sek(data.reconciliationDifferenceSek)} (startbasen är högre) — inte vinst. Ingen automatisk Avanza-koppling.</p>
      <p className="mt-1">Utveckling = manuellt totalvärde − observerat startvärde − nettoinsättningar/uttag sedan {data.baseDate}.
        Procent räknas mot vald startbas. Startdifferensen hålls utanför resultatet. Enkel värdeförändring, inte verifierad trade-P&amp;L eller tidsvägd avkastning.</p>
      {data.latest && <p className="mt-1">Värdeskillnad mot vald startbas före justering: {sek(data.latest.rawChangeSek)}.
        {" "}Externt netto sedan start: {data.latest.netExternalFlowsSek == null ? "ej avstämt" : sek(data.latest.netExternalFlowsSek)}.</p>}
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        if (save.isPending || !value.trim() || (flowsKnown && !flows.trim())) return;
        if (!Number.isFinite(manualSek(value)) || (flowsKnown && !Number.isFinite(manualSek(flows)))) {
          setMessage("Ange giltiga belopp i SEK, med högst två decimaler."); return;
        }
        setMessage("");
        save.mutate({ data: { asOfDate: date, totalValueSek: manualSek(value),
          netExternalFlowsSek: flowsKnown ? manualSek(flows) : null } });
      }}>
        <label className="grid gap-1">Datum<input required type="date" min={data.baseDate}
          max={new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date())}
          value={date} onChange={e => setDate(e.target.value)} className="rounded border bg-background p-1.5" /></label>
        <label className="grid gap-1">Totalt portföljvärde, SEK<input required inputMode="decimal" value={value}
          onChange={e => setValue(e.target.value)} placeholder="Inkl. kontanter" className="rounded border bg-background p-1.5" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={flowsKnown} onChange={e => setFlowsKnown(e.target.checked)} />
          Insättningar/uttag sedan start är avstämda</label>
        {flowsKnown && <label className="grid gap-1">Netto sedan start, SEK (+ in / − ut)<input required inputMode="decimal"
          value={flows} onChange={e => setFlows(e.target.value)} className="rounded border bg-background p-1.5" /></label>}
        <button disabled={save.isPending} className="rounded border px-3 py-1.5 text-foreground" type="submit">
          {save.isPending ? "Sparar…" : "Spara avstämning"}</button>
      </form>
      {message && <p role="status" className="mt-2">{message}</p>}
      {save.error && <p role="alert" className="mt-2 text-destructive">{save.error.message}</p>}
      {data.history.length > 0 && <details className="mt-3"><summary>Sparade avstämningar ({data.history.length})</summary>
        {data.history.map(row => <p key={row.id} className="mt-1">{row.asOfDate} · {sek(row.totalValueSek)}
          {" "}· nettoflöden {row.netExternalFlowsSek == null ? "ej avstämda" : sek(row.netExternalFlowsSek)}</p>)}
      </details>}
    </details>
  </section>;
}
