import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetGroundZero, useCreateGroundZeroSnapshot, useDeleteGroundZeroSnapshot, getGetGroundZeroQueryKey, type GroundZeroState } from "@workspace/api-client-react";

const sek = (n: number) => n.toLocaleString("sv-SE", { style: "currency", currency: "SEK", minimumFractionDigits: 2 });
export const manualSek = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."));
export function GroundZeroHistory({ history, confirming, busy, onRequest, onCancel, onConfirm }: {
  history: GroundZeroState["history"]; confirming: number | null; busy: boolean;
  onRequest: (id: number) => void; onCancel: () => void; onConfirm: (id: number) => void;
}) {
  return <details className="mt-3"><summary className="cursor-pointer">Sparade avstämningar ({history.length})</summary>
    <ul className="mt-2 divide-y divide-border">
      {history.map(row => <li key={row.id} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{row.asOfDate} · <strong className="text-foreground">{sek(row.totalValueSek)}</strong>
            {" "}· nettoflöden {row.netExternalFlowsSek == null ? "ej avstämda" : sek(row.netExternalFlowsSek)}</span>
          <button type="button" disabled={busy} onClick={() => onRequest(row.id)}
            aria-label={`Radera avstämning ${row.asOfDate}, ${sek(row.totalValueSek)}`}
            className="rounded border px-3 py-1.5 text-destructive disabled:opacity-50">Radera</button>
        </div>
        {confirming === row.id && <div role="group" aria-label="Bekräfta radering" className="mt-2 rounded border border-destructive/30 p-3">
          <p>Radera avstämningen {row.asOfDate} på <strong>{sek(row.totalValueSek)}</strong>?
            {" "}Den tas bort permanent. Övriga avstämningar, trades och journal påverkas inte.
            {" "}Resultatraden visar därefter den senaste kvarvarande avstämningen.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => onCancel()} className="rounded border px-3 py-2">Avbryt</button>
            <button type="button" disabled={busy} onClick={() => onConfirm(row.id)}
              className="rounded bg-destructive px-3 py-2 text-destructive-foreground disabled:opacity-50">
              {busy ? "Raderar…" : "Ja, radera avstämningen"}</button>
          </div>
        </div>}
      </li>)}
    </ul>
  </details>;
}
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
  const [confirming, setConfirming] = useState<number | null>(null);
  const remove = useDeleteGroundZeroSnapshot({ mutation: {
    onSuccess: data => {
      client.setQueryData(getGetGroundZeroQueryKey(), data);
      setConfirming(null);
      setMessage("Avstämningen raderad. Övriga avstämningar och tradinghistoriken är oförändrade.");
    },
  } });
  const busy = save.isPending || remove.isPending;
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
        if (busy || !value.trim() || (flowsKnown && !flows.trim())) return;
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
        <button disabled={busy} className="rounded border px-3 py-1.5 text-foreground disabled:opacity-50" type="submit">
          {save.isPending ? "Sparar…" : "Spara avstämning"}</button>
      </form>
      {value.trim() && Number.isFinite(manualSek(value)) && <p className="mt-2 text-foreground">
        Du sparar: <strong>{sek(manualSek(value))}</strong> · {date}. Kontrollera belopp och datum före sparande.</p>}
      {message && <p role="status" className="mt-2">{message}</p>}
      {save.error && <p role="alert" className="mt-2 text-destructive">{save.error.message}</p>}
      {remove.error && <p role="alert" className="mt-2 text-destructive">Kunde inte radera: {remove.error.message}
        {" "}<button type="button" onClick={() => query.refetch()} className="underline">Uppdatera listan</button></p>}
      {data.history.length > 0 && <GroundZeroHistory history={data.history} confirming={confirming} busy={busy}
        onRequest={id => { remove.reset(); setMessage(""); setConfirming(id); }}
        onCancel={() => { remove.reset(); setConfirming(null); }}
        onConfirm={id => { if (!busy) remove.mutate({ id }); }} />}
    </details>
  </section>;
}
