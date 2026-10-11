import { RiskPanel } from "./RiskPanel";
import { JournalAnalysis } from "./JournalAnalysis";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJournalRecords,
  useCreateJournalRecord,
  useListCandidates,
  getListJournalRecordsQueryKey,
} from "@workspace/api-client-react";
import type { JournalEntryInput, JournalRecord } from "@workspace/api-client-react";

type Mode = "REAL" | "SIMULATED" | "NOT_TAKEN";
const MODES: Mode[] = ["REAL", "SIMULATED", "NOT_TAKEN"];
const inp = "w-full bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary";
const TZ = /(Z|[+-]\d{2}:?\d{2})$/;

const EMPTY = {
  candidateId: "", mode: "" as Mode | "", instrumentKind: "", side: "", priceCurrency: "", entryFxSek: "", exitFxSek: "",
  entryTime: "", exitTime: "", fillPrice: "", stopPrice: "", targetPrice: "", exitPrice: "",
  quantity: "", leverage: "", spreadCostKr: "", slippageCostKr: "", financingCostKr: "", commissionKr: "", notes: "",
};

function num(v: number | null | undefined, d = 2) {
  return v == null ? "–" : v.toLocaleString("sv-SE", { maximumFractionDigits: d });
}
function cost(v: number | null | undefined) {
  return v == null ? "okänd" : num(v);
}
function when(v: string | null | undefined) {
  return v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }) : "–";
}
function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function optNum(s: string): number | null {
  return s.trim() === "" ? null : Number(s);
}
function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="block text-[10px] text-muted-foreground">{t}<div className="mt-1">{children}</div></label>;
}

export function TradeJournal() {
  const qc = useQueryClient();
  const records = useListJournalRecords();
  const candidates = useListCandidates();
  const create = useCreateJournalRecord();
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Mode>("REAL");
  const idRef = useRef<string | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  const cands = candidates.data ?? [];
  const cand = cands.find((c) => String(c.id) === f.candidateId);
  const rows: JournalRecord[] = (records.data as JournalRecord[] | undefined) ?? [];
  const counts = useMemo(() => {
    const c: Record<Mode, number> = { REAL: 0, SIMULATED: 0, NOT_TAKEN: 0 };
    rows.forEach((r) => { c[r.input.mode] += 1; });
    return c;
  }, [rows]);
  const shown = rows.filter((r) => r.input.mode === filter);

  const submit = () => {
    setNotice(null);
    const e: string[] = [];
    if (!cand) e.push("Välj en källsignal.");
    if (!f.mode) e.push("Välj REAL, SIMULATED eller NOT_TAKEN.");
    let input: JournalEntryInput | null = null;
    if (cand && f.mode) {
      if (!idRef.current) idRef.current = crypto.randomUUID();
      const notes = f.notes.trim();
      if (notes.length > 2000) e.push("Anteckningar max 2000 tecken.");
      if (f.mode === "NOT_TAKEN") {
        if (!notes) e.push("NOT_TAKEN kräver anteckning som förklarar varför.");
        input = {
          id: idRef.current, candidateId: cand.id, mode: "NOT_TAKEN", instrumentKind: null, side: null,
          entryTime: null, exitTime: null, fillPrice: null, stopPrice: null, targetPrice: null, exitPrice: null,
          quantity: null, leverage: null, spreadCostKr: null, slippageCostKr: null, financingCostKr: null,
          commissionKr: null, notes,
          priceCurrency: null, entryFxSek: null, exitFxSek: null,
        };
      } else {
        const req: [string, string][] = [
          ["Faktisk fill", f.fillPrice], ["Initial stop", f.stopPrice], ["Initialt target", f.targetPrice],
          ["Exit", f.exitPrice], ["Antal", f.quantity],
        ];
        const v: Record<string, number> = {};
        req.forEach(([l, s]) => {
          const n = Number(s);
          if (s.trim() === "" || !Number.isFinite(n) || n <= 0) e.push(`${l} måste vara ett positivt tal.`);
          else v[l] = n;
        });
        if (!f.instrumentKind) e.push("Välj SHARE eller PRODUCT.");
        if (!f.side) e.push("Välj ägd sida LONG eller SHORT.");
        let efx: number | null = null, xfx: number | null = null;
        if (!f.priceCurrency) e.push("Välj prisvaluta SEK eller USD.");
        else if (f.priceCurrency === "SEK") { efx = 1; xfx = 1; }
        else {
          efx = Number(f.entryFxSek); xfx = Number(f.exitFxSek);
          if (f.entryFxSek.trim() === "" || !Number.isFinite(efx) || efx <= 0) e.push("Entry-FX (SEK per USD) måste vara positivt.");
          if (f.exitFxSek.trim() === "" || !Number.isFinite(xfx) || xfx <= 0) e.push("Exit-FX (SEK per USD) måste vara positivt.");
        }
        const en = toIso(f.entryTime), ex = toIso(f.exitTime);
        if (!en) e.push("Entry-tid krävs.");
        if (!ex) e.push("Exit-tid krävs.");
        if (en && ex && Date.parse(ex) < Date.parse(en)) e.push("Exit får inte vara före entry.");
        if (en && !TZ.test(en)) e.push("Entry-tid saknar tidszon.");
        const lev = optNum(f.leverage);
        if (lev != null && (!Number.isFinite(lev) || lev <= 0)) e.push("Hävstång måste vara positiv eller tom.");
        const costs = (["spreadCostKr", "slippageCostKr", "financingCostKr", "commissionKr"] as const).map((k) => {
          const n = optNum(f[k]);
          if (n != null && (!Number.isFinite(n) || n < 0)) e.push(`${k} måste vara ≥ 0 eller tom.`);
          return n;
        });
        if (e.length === 0) {
          input = {
            id: idRef.current, candidateId: cand.id, mode: f.mode,
            instrumentKind: f.instrumentKind as "SHARE" | "PRODUCT", side: f.side as "LONG" | "SHORT",
            entryTime: en, exitTime: ex, fillPrice: v["Faktisk fill"], stopPrice: v["Initial stop"],
            targetPrice: v["Initialt target"], exitPrice: v["Exit"], quantity: v["Antal"], leverage: lev,
            spreadCostKr: costs[0], slippageCostKr: costs[1], financingCostKr: costs[2], commissionKr: costs[3], notes,
            priceCurrency: f.priceCurrency as "SEK" | "USD", entryFxSek: efx, exitFxSek: xfx,
          };
        }
      }
    }
    setErrs(e);
    if (e.length || !input) return;
    create.mutate({ data: input }, {
      onSuccess: (record) => {
        qc.setQueryData<JournalRecord[]>(getListJournalRecordsQueryKey(), (existing) =>
          [record, ...(existing ?? []).filter(row => row.id !== record.id)]);
        setFilter(record.input.mode);
        idRef.current = null;
        setF(EMPTY);
        setNotice("Journalpost sparad (append-only).");
        qc.invalidateQueries({ queryKey: getListJournalRecordsQueryKey() });
      },
    });
  };

  const apiErr = create.error ? ((create.error as { message?: string }).message ?? "Okänt fel") : null;
  const isTaken = f.mode === "REAL" || f.mode === "SIMULATED";
  const numIn = (k: keyof typeof EMPTY, ph = "") => (
    <input type="number" step="any" inputMode="decimal" value={f[k]} placeholder={ph}
      onChange={(ev) => set(k, ev.target.value)} className={inp} data-testid={`input-journal-${k}`} />
  );

  return (
    <div className="font-mono border border-border rounded-lg bg-card overflow-hidden" data-testid="trade-journal">
      <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
        === FRIVILLIG EXEKVERINGSJOURNAL ===
      </div>
      <div className="p-4 space-y-3 text-xs">
        <details><summary className="cursor-pointer text-muted-foreground">Om journalen och beräkningar</summary>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          Journalen är append-only och separat: den ändrar aldrig signaler, utfall eller Challenge Tracker.
          REAL, SIMULATED och NOT_TAKEN är olika underlag och summeras aldrig som bevis på edge.
          {" "}R beräknas från faktisk fill och initial stop. USD-resultat inkluderar angivna valutakurser.
          Finansiering och courtage dras en gång; okända värden ger okänt netto-R.
          En verkligt utförd sen eller planbruten trade får journalföras; ogiltig initial risk ger okänt R, inte ett påhittat resultat.
          Tider anges i webbläsarens lokala tidszon och visas här i Stockholmstid.
        </p></details>

        {records.isLoading && <p>Läser befintlig journal…</p>}
        {records.isError && <p role="alert" className="text-destructive">Journalen kunde inte läsas. Inga tomma eller syntetiska resultat används.</p>}
        {!records.isLoading && !records.isError && <JournalAnalysis records={rows} />}
        <details className="border border-border rounded">
          <summary className="cursor-pointer px-3 py-2 text-primary" data-testid="button-journal-toggle">Ny journalpost</summary>
          <div className="p-3 space-y-3 border-t border-border bg-muted/20">
            <L t="Källsignal">
              <select value={f.candidateId} onChange={(e) => set("candidateId", e.target.value)} className={inp} data-testid="select-journal-candidate">
                <option value="">Välj signal…</option>
                {cands.map((c) => (
                  <option key={c.id} value={c.id}>{c.signalDate ?? "okänt datum"} · {c.ticker} · {c.direction} · {c.signalSource ?? "okänd källa"}</option>
                ))}
              </select>
            </L>
            {candidates.isLoading && <div className="text-muted-foreground animate-pulse">Laddar signaler…</div>}
            {candidates.isError && <div className="text-red-400">Kunde inte läsa signaler.</div>}
            {cand && (
              <div className="rounded border border-border p-2 text-muted-foreground" data-testid="text-journal-plan">
                Original (oföränderlig): {cand.ticker} {cand.direction} · {cand.category} · signal {cand.signalDate ?? "okänt"} · källa {cand.signalSource ?? "okänd"}
                <br />entry {num(cand.entryPrice)} · stop {num(cand.stopPrice)} · target {num(cand.targetPrice)} · R/R {num(cand.rr)}
              </div>
            )}
            <L t="Läge (måste väljas)">
              <select value={f.mode} onChange={(e) => set("mode", e.target.value)} className={inp} data-testid="select-journal-mode">
                <option value="">Välj läge…</option>
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </L>
            {isTaken && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <L t="Instrument">
                    <select value={f.instrumentKind} onChange={(e) => set("instrumentKind", e.target.value)} className={inp} data-testid="select-journal-kind">
                      <option value="">Välj…</option><option value="SHARE">SHARE</option><option value="PRODUCT">PRODUCT</option>
                    </select>
                  </L>
                  <L t="Ägd sida i instrumentet">
                    <select value={f.side} onChange={(e) => set("side", e.target.value)} className={inp} data-testid="select-journal-side">
                      <option value="">Välj…</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option>
                    </select>
                  </L>
                  <L t="Prisvaluta (välj uttryckligen)">
                    <select value={f.priceCurrency} onChange={(e) => set("priceCurrency", e.target.value)} className={inp} data-testid="select-journal-currency">
                      <option value="">Välj…</option><option value="SEK">SEK</option><option value="USD">USD</option>
                    </select>
                  </L>
                  {f.priceCurrency === "USD" && <>
                    <L t="FX vid entry (SEK per USD)">{numIn("entryFxSek")}</L>
                    <L t="FX vid exit (SEK per USD)">{numIn("exitFxSek")}</L>
                  </>}
                  <L t="Entry-tid (lokal tid, sparas som ISO)">
                    <input type="datetime-local" value={f.entryTime} onChange={(e) => set("entryTime", e.target.value)} className={inp} data-testid="input-journal-entryTime" />
                  </L>
                  <L t="Exit-tid (lokal tid, sparas som ISO)">
                    <input type="datetime-local" value={f.exitTime} onChange={(e) => set("exitTime", e.target.value)} className={inp} data-testid="input-journal-exitTime" />
                  </L>
                  <L t="Faktisk fill (inkl. spread/slippage)">{numIn("fillPrice")}</L>
                  <L t="Exit (faktisk fill)">{numIn("exitPrice")}</L>
                  <L t="Initial stop">{numIn("stopPrice")}</L>
                  <L t="Initialt target">{numIn("targetPrice")}</L>
                  <L t="Antal">{numIn("quantity")}</L>
                  <L t="Hävstång (endast information)">{numIn("leverage", "tom = okänd")}</L>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Kostnader i kr, tomt = okänt (inte noll). Spread och slippage är redan inräknade i fills och dras inte av två gånger.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <L t="Spread (kr, redan i fills)">{numIn("spreadCostKr")}</L>
                  <L t="Slippage (kr, redan i fills)">{numIn("slippageCostKr")}</L>
                  <L t="Finansiering (kr)">{numIn("financingCostKr")}</L>
                  <L t="Courtage (kr)">{numIn("commissionKr")}</L>
                </div>
              </div>
            )}
            <L t={f.mode === "NOT_TAKEN" ? "Varför togs den inte? (krävs)" : "Anteckningar"}>
              <textarea value={f.notes} maxLength={2000} rows={3} onChange={(e) => set("notes", e.target.value)} className={inp} data-testid="input-journal-notes" />
            </L>
            {errs.length > 0 && (
              <ul className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-400 space-y-0.5" data-testid="text-journal-validation">
                {errs.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
            {apiErr && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-400" data-testid="text-journal-error">
                {apiErr} — försök igen; samma post-id återanvänds.
              </div>
            )}
            {notice && <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-400" data-testid="text-journal-success">{notice}</div>}
            <button onClick={submit} disabled={create.isPending}
              className="bg-primary text-primary-foreground px-4 py-1.5 rounded hover:bg-primary/90 disabled:opacity-50" data-testid="button-journal-submit">
              {create.isPending ? "Sparar…" : "Spara journalpost"}
            </button>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button key={m} onClick={() => setFilter(m)} data-testid={`button-journal-filter-${m}`}
              className={`px-2 py-1 rounded border ${filter === m ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
              {m} ({counts[m]})
            </button>
          ))}
        </div>

        {records.isLoading && <div className="animate-pulse text-muted-foreground">Laddar journal…</div>}
        {records.isError && (
          <div className="text-red-400">
            Kunde inte läsa journalen.{" "}
            <button onClick={() => records.refetch()} className="underline" data-testid="button-journal-retry">Försök igen</button>
          </div>
        )}
        {!records.isLoading && !records.isError && shown.length === 0 && (
          <div className="text-muted-foreground/60">→ inga {filter}-poster</div>
        )}
        {shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] whitespace-nowrap" data-testid="table-journal">
              <thead>
                <tr className="text-left text-muted-foreground uppercase">
                  {["Signal", "Källa", "Volymdatum", "Bucket", "Riktn.", "Valuta", "FX entry/exit (SEK/USD)", "Instr.", "Entry", "Exit-tid", "Fill", "Stop", "Target", "Exit", "Antal", "Hävst.", "Spread", "Slipp.", "Finans.", "Court.", "Brutto R", "Netto R", "Anteckning"].map((h) => (
                    <th key={h} className="px-2 py-1 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const i = r.input;
                  return (
                    <tr key={r.id} className="border-t border-border/50" data-testid={`row-journal-${r.id}`}>
                      <td className="px-2 py-1">{r.signal.ticker} {r.signal.signalDate ?? "okänt"}</td>
                      <td className="px-2 py-1">{r.signal.source ?? "okänd"}</td>
                      <td className="px-2 py-1">{r.signal.dataDate ?? "okänt"}</td>
                      <td className="px-2 py-1">{r.signal.bucket}</td>
                      <td className="px-2 py-1">{r.signal.direction}</td>
                      <td className="px-2 py-1">{i.priceCurrency ?? "–"}</td>
                      <td className="px-2 py-1">{num(i.entryFxSek, 4)} / {num(i.exitFxSek, 4)}</td>
                      <td className="px-2 py-1">{i.instrumentKind ?? "–"} {i.side ?? ""}
                        {i.fillPrice != null && i.stopPrice != null && i.targetPrice != null && i.side &&
                          <RiskPanel plan={{ direction: i.side, entryPrice: i.fillPrice, stopPrice: i.stopPrice, targetPrice: i.targetPrice }}
                            instrument={i.instrumentKind ?? "UNDERLYING"} netR={r.metrics.netR} />}
                      </td>
                      <td className="px-2 py-1">{when(i.entryTime)}</td>
                      <td className="px-2 py-1">{when(i.exitTime)}</td>
                      <td className="px-2 py-1">{num(i.fillPrice)}</td>
                      <td className="px-2 py-1">{num(i.stopPrice)}</td>
                      <td className="px-2 py-1">{num(i.targetPrice)}</td>
                      <td className="px-2 py-1">{num(i.exitPrice)}</td>
                      <td className="px-2 py-1">{num(i.quantity, 4)}</td>
                      <td className="px-2 py-1">{i.leverage == null ? "–" : `${num(i.leverage)}x`}</td>
                      <td className="px-2 py-1">{i.mode === "NOT_TAKEN" ? "–" : cost(i.spreadCostKr)}</td>
                      <td className="px-2 py-1">{i.mode === "NOT_TAKEN" ? "–" : cost(i.slippageCostKr)}</td>
                      <td className="px-2 py-1">{i.mode === "NOT_TAKEN" ? "–" : cost(i.financingCostKr)}</td>
                      <td className="px-2 py-1">{i.mode === "NOT_TAKEN" ? "–" : cost(i.commissionKr)}</td>
                      <td className="px-2 py-1">{num(r.metrics.grossR)}</td>
                      <td className="px-2 py-1">{r.metrics.netR == null ? "okänt" : num(r.metrics.netR)}</td>
                      <td className="px-2 py-1 whitespace-normal min-w-[12rem]">{i.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default TradeJournal;
