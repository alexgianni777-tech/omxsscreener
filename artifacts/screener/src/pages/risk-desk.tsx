import { useMemo, useState } from "react";
import { ShieldAlert, Calculator, AlertTriangle } from "lucide-react";
import { calculateLeverageRisk, type TradeDirection } from "../lib/leverageRisk";

const money = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 }) + " kr";
const pct = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 2 }) + " %";
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono";

function NumberField({ label, value, onChange, step = "any" }: {
  label: string; value: string; onChange: (s: string) => void; step?: string;
}) {
  return <label className="flex flex-col gap-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <input className={field} type="number" step={step} value={value}
      onChange={e => onChange(e.target.value)} />
  </label>;
}

export function RiskDesk() {
  const [capital, setCapital] = useState("5000");
  const [risk, setRisk] = useState("2");
  const [leverage, setLeverage] = useState("4");
  const [direction, setDirection] = useState<TradeDirection>("LONG");
  const [entry, setEntry] = useState("100");
  const [stop, setStop] = useState("98");
  const [target, setTarget] = useState("104");
  const [cost, setCost] = useState("1.5");
  const [knockout, setKnockout] = useState("");

  const res = useMemo(() => calculateLeverageRisk({
    capitalKr: Number(capital),
    accountRiskPct: Number(risk),
    leverageX: Number(leverage),
    direction,
    entry: Number(entry),
    stop: Number(stop),
    target: Number(target),
    instrumentRoundtripCostPct: Number(cost),
    knockoutDistancePct: knockout.trim() === "" ? null : Number(knockout),
  }), [capital, risk, leverage, direction, entry, stop, target, cost, knockout]);

  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="space-y-2 border-b border-border pb-4">
      <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
        <ShieldAlert className="w-7 h-7" /> Risk Desk
      </h2>
      <p className="text-muted-foreground text-sm">
        Manuell positionskalkyl för mini futures, 4–8×. Asset Screen analyserar endast underliggande aktier.
      </p>
    </header>
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <strong>Analys, inte orderråd.</strong> Inga instrument väljs eller köps automatiskt.
      Ange verkliga produktvillkor från Avanza innan något handelsbeslut.
      Kostnad, knockout och faktiskt stopputförande kan avvika från modellen.
    </div>
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex gap-2 items-center"><Calculator className="w-5 h-5" /> Räkna på affären</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <NumberField label="Kontokapital (kr)" value={capital} onChange={setCapital} />
        <NumberField label="Planerad maximal risk (% av konto, högst 4)" value={risk} onChange={setRisk} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Indikativ hävstång</span>
          <select className={field} value={leverage} onChange={e => setLeverage(e.target.value)}>
            <option value="4">4×</option><option value="6">6×</option><option value="8">8×</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Riktning</span>
          <select className={field} value={direction} onChange={e => setDirection(e.target.value as TradeDirection)}>
            <option value="LONG">LONG</option><option value="SHORT">SHORT</option>
          </select>
        </label>
        <NumberField label="Entry i underliggande (kr)" value={entry} onChange={setEntry} />
        <NumberField label="Stop i underliggande (kr)" value={stop} onChange={setStop} />
        <NumberField label="Mål i underliggande (kr)" value={target} onChange={setTarget} />
        <NumberField label="Total handelskostnad (% av mini-futurens värde)" value={cost} onChange={setCost} />
        <NumberField label="Avstånd till knockout i underliggande (%) – obligatoriskt för kontroll" value={knockout} onChange={setKnockout} />
      </div>
    </section>
    {res.errors.length > 0 && <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 space-y-1">
      {res.errors.map((msg,i) => <p key={i} className="text-sm text-destructive">{msg}</p>)}
    </section>}
    {res.valid && <>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {label:"Maximal insats enligt riskmodell",value:money(res.maximumInvestmentKr)},
          {label:"Ungefärlig exponering",value:money(res.exposureKr)},
          {label:"Förlust vid planerad stop",value:"−"+money(res.estimatedLossKr)},
          {label:"Vinst vid planerat mål",value:(res.estimatedWinKr >= 0 ? "+" : "−")+money(Math.abs(res.estimatedWinKr))},
          {label:"Underliggande till stop",value:pct(res.underlyingStopPct)},
          {label:"Underliggande till mål",value:pct(res.underlyingTargetPct)},
          {label:"Mini future: stop inkl. kostnad",value:"−"+pct(res.estimatedInstrumentLossPct)},
          {label:"R/R efter kostnader",value:res.rr == null ? "Ej positiv" : res.rr.toFixed(2).replace(".",",")+":1"}
        ].map(item=><div key={item.label} className="border border-border rounded-lg bg-card p-3">
          <div className="text-xs text-muted-foreground min-h-8">{item.label}</div>
          <div className="text-lg font-semibold font-mono mt-2">{item.value}</div>
        </div>)}
      </section>
      <section className="border border-border rounded-xl p-4 space-y-3">
        <h3 className="font-semibold flex gap-2 items-center"><AlertTriangle className="w-4 h-4" /> Riskbedömning</h3>
        {res.warnings.map((w,i)=><p key={i} className="text-sm text-amber-500">{w}</p>)}
        <p className="text-xs text-muted-foreground">
          Indikativ hävstång approximerar kurskänsligheten, inte ett lån med garanterad konstant multipel.
          Ingen stop-loss garanterar förlusttak. Courtage, emittentvillkor och produktspecifik spread måste kontrolleras.
          Styrelsebeslut krävs före affär.
        </p>
      </section>
    </>}
  </div>;
}
