import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase, TrendingUp, TrendingDown, RefreshCw, Plus, Trash2,
  AlertTriangle, Target, ShieldAlert, ChevronUp, ChevronDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}/api${path}`;

// ── types ──────────────────────────────────────────────────────────────────────
interface Position {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  market: string | null;
  notes: string | null;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  shares: number;
  positionSizeKr: number;
  risk1R: number | null;
  createdAt: string;
  livePrice: number | null;
  changePct: number | null;
  unrealisedPct: number | null;
  unrealisedKr: number | null;
  currentR: number | null;
  marketValueKr: number | null;
  distToStop: number | null;
  distToTarget: number | null;
}

interface PortfolioData {
  positions: Position[];
  summary: {
    count: number;
    totalInvestedKr: number;
    totalMarketValueKr: number;
    totalUnrealisedKr: number;
    totalUnrealisedPct: number;
  };
}

// ── helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number, dec = 0) {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function sgn(n: number, dec = 2) {
  return (n >= 0 ? "+" : "−") + fmt(Math.abs(n), dec);
}
function daysHeld(createdAt: string) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const d = Math.floor(ms / 86_400_000);
  return d === 0 ? "Idag" : d === 1 ? "1 dag" : `${d} dagar`;
}

// ── summary card ───────────────────────────────────────────────────────────────
function SummaryBar({ summary }: { summary: PortfolioData["summary"] }) {
  const isUp = summary.totalUnrealisedKr >= 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Tile label="Positioner" value={String(summary.count)} />
      <Tile label="Investerat" value={`${fmt(summary.totalInvestedKr)} kr`} />
      <Tile
        label="Marknadsvärde"
        value={`${fmt(summary.totalMarketValueKr)} kr`}
      />
      <Tile
        label="Orealiserat P&L"
        value={`${sgn(summary.totalUnrealisedKr, 0)} kr`}
        sub={`${sgn(summary.totalUnrealisedPct, 2)}%`}
        valueClass={isUp ? "text-success" : "text-destructive"}
      />
    </div>
  );
}

function Tile({ label, value, sub, valueClass = "" }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className={`text-xs font-mono tabular-nums mt-0.5 ${valueClass || "text-muted-foreground"}`}>{sub}</p>}
    </div>
  );
}

// ── price bar: entry → stop/target ────────────────────────────────────────────
function PriceBar({ pos }: { pos: Position }) {
  if (!pos.stopPrice && !pos.targetPrice) return null;
  const isShort = pos.direction === "SHORT";
  const lo = isShort
    ? Math.min(pos.targetPrice ?? pos.entryPrice, pos.stopPrice ? pos.stopPrice - (pos.entryPrice - (pos.targetPrice ?? pos.entryPrice)) : pos.entryPrice) * 0.995
    : Math.min(pos.stopPrice ?? pos.entryPrice * 0.95, pos.entryPrice) * 0.99;
  const hi = isShort
    ? Math.max(pos.stopPrice ?? pos.entryPrice * 1.05, pos.entryPrice) * 1.01
    : Math.max(pos.targetPrice ?? pos.entryPrice * 1.1, pos.entryPrice) * 1.005;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const live = pos.livePrice;

  return (
    <div className="relative h-2 bg-muted rounded-full my-2 mx-1">
      {/* stop line */}
      {pos.stopPrice && (
        <div
          className="absolute top-0 h-full w-0.5 bg-destructive/70 rounded-full"
          style={{ left: `${pct(pos.stopPrice)}%` }}
          title={`Stop: ${fmt(pos.stopPrice, 2)}`}
        />
      )}
      {/* target line */}
      {pos.targetPrice && (
        <div
          className="absolute top-0 h-full w-0.5 bg-success/70 rounded-full"
          style={{ left: `${pct(pos.targetPrice)}%` }}
          title={`Target: ${fmt(pos.targetPrice, 2)}`}
        />
      )}
      {/* entry dot */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary border border-background"
        style={{ left: `calc(${pct(pos.entryPrice)}% - 4px)` }}
        title={`Entry: ${fmt(pos.entryPrice, 2)}`}
      />
      {/* live dot */}
      {live && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background shadow-sm ${
            (pos.unrealisedKr ?? 0) >= 0 ? "bg-success" : "bg-destructive"
          }`}
          style={{ left: `calc(${pct(live)}% - 6px)` }}
          title={`Live: ${fmt(live, 2)}`}
        />
      )}
    </div>
  );
}

// ── single position card ───────────────────────────────────────────────────────
function PositionCard({ pos, onDelete }: { pos: Position; onDelete: (id: number) => void }) {
  const isShort = pos.direction === "SHORT";
  const pnlUp = (pos.unrealisedKr ?? 0) >= 0;
  const rVal = pos.currentR ?? 0;
  const rColor = rVal >= 1 ? "text-success" : rVal <= -0.5 ? "text-destructive" : "text-amber-500";

  return (
    <div className={`bg-card border rounded-lg p-5 shadow-sm transition-colors ${
      pnlUp ? "border-success/20" : (pos.unrealisedKr ?? 0) < 0 ? "border-destructive/20" : "border-border"
    }`}>
      {/* header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-xl tracking-tight">{pos.ticker}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
            isShort ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
          }`}>
            {isShort ? "▼ SHORT" : "▲ LONG"}
          </span>
          {pos.market && (
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {pos.market}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">{daysHeld(pos.createdAt)}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* live price */}
          {pos.livePrice != null && (
            <div className="text-right">
              <div className="font-mono font-bold text-base">{fmt(pos.livePrice, 2)}</div>
              {pos.changePct != null && (
                <div className={`text-xs font-mono flex items-center justify-end gap-0.5 ${
                  pos.changePct >= 0 ? "text-success" : "text-destructive"
                }`}>
                  {pos.changePct >= 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {Math.abs(pos.changePct).toFixed(2)}%
                </div>
              )}
            </div>
          )}
          {/* P&L */}
          {pos.unrealisedKr != null && (
            <div className={`text-right px-2 py-1 rounded ${pnlUp ? "bg-success/10" : "bg-destructive/10"}`}>
              <div className={`font-mono font-bold text-sm ${pnlUp ? "text-success" : "text-destructive"}`}>
                {sgn(pos.unrealisedKr, 0)} kr
              </div>
              {pos.unrealisedPct != null && (
                <div className={`text-xs font-mono ${pnlUp ? "text-success" : "text-destructive"}`}>
                  {sgn(pos.unrealisedPct, 2)}%
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => onDelete(pos.id)}
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Ta bort position"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* price bar */}
      <PriceBar pos={pos} />

      {/* metrics grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 mt-3 text-xs">
        <MetricCell label="Entry" value={fmt(pos.entryPrice, 2)} />
        <MetricCell
          label="Stop"
          value={pos.stopPrice ? fmt(pos.stopPrice, 2) : "–"}
          sub={pos.distToStop != null ? `${pos.distToStop >= 0 ? "+" : ""}${fmt(pos.distToStop, 1)}%` : undefined}
          subClass={pos.distToStop != null && pos.distToStop < 5 ? "text-destructive" : "text-muted-foreground"}
          icon={<ShieldAlert className="h-3 w-3 text-destructive/60" />}
        />
        <MetricCell
          label="Target"
          value={pos.targetPrice ? fmt(pos.targetPrice, 2) : "–"}
          sub={pos.distToTarget != null ? `${pos.distToTarget >= 0 ? "+" : ""}${fmt(pos.distToTarget, 1)}%` : undefined}
          subClass="text-muted-foreground"
          icon={<Target className="h-3 w-3 text-success/60" />}
        />
        <MetricCell label="Antal" value={fmt(pos.shares, 0)} />
        <MetricCell label="Investerat" value={`${fmt(pos.positionSizeKr, 0)} kr`} />
        <MetricCell
          label="Nuv. R"
          value={pos.currentR != null ? `${sgn(pos.currentR, 2)}R` : "–"}
          valueClass={rColor}
        />
      </div>

      {/* notes */}
      {pos.notes && (
        <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground italic">
          {pos.notes}
        </div>
      )}
    </div>
  );
}

function MetricCell({
  label, value, sub, valueClass = "", subClass = "text-muted-foreground", icon,
}: {
  label: string; value: string; sub?: string; valueClass?: string; subClass?: string; icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {icon}{label}
      </div>
      <div className={`font-mono font-semibold ${valueClass}`}>{value}</div>
      {sub && <div className={`font-mono text-[10px] ${subClass}`}>{sub}</div>}
    </div>
  );
}

// ── add-position form ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  ticker: "", direction: "LONG" as "LONG" | "SHORT",
  entryPrice: "", shares: "", stopPrice: "", targetPrice: "",
  market: "SE" as "SE" | "US", notes: "",
};

function AddPositionForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.ticker.trim() || !form.entryPrice || !form.shares) {
      setError("Ticker, entrypris och antal aktier krävs.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(api("/portfolio"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: form.ticker.trim().toUpperCase(),
          direction: form.direction,
          entryPrice: parseFloat(form.entryPrice),
          shares: parseFloat(form.shares),
          stopPrice: form.stopPrice ? parseFloat(form.stopPrice) : undefined,
          targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : undefined,
          market: form.market || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Fel ${res.status}`);
        return;
      }
      setForm(EMPTY_FORM);
      onSuccess();
    } catch (e: any) {
      setError(e.message ?? "Nätverksfel");
    } finally {
      setSubmitting(false);
    }
  };

  const inp = "w-full bg-background border border-border rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const label = "text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block";

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" /> Lägg till position
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label className={label}>Ticker</label>
          <input className={inp} placeholder="ABB" value={form.ticker} onChange={e => set("ticker", e.target.value)} />
        </div>
        <div>
          <label className={label}>Riktning</label>
          <select className={inp} value={form.direction} onChange={e => set("direction", e.target.value as "LONG" | "SHORT")}>
            <option value="LONG">▲ LONG</option>
            <option value="SHORT">▼ SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Marknad</label>
          <select className={inp} value={form.market} onChange={e => set("market", e.target.value as "SE" | "US")}>
            <option value="SE">SE</option>
            <option value="US">US</option>
          </select>
        </div>
        <div>
          <label className={label}>Antal aktier</label>
          <input className={inp} type="number" placeholder="100" value={form.shares} onChange={e => set("shares", e.target.value)} />
        </div>
        <div>
          <label className={label}>Entry-pris</label>
          <input className={inp} type="number" step="0.01" placeholder="123.40" value={form.entryPrice} onChange={e => set("entryPrice", e.target.value)} />
        </div>
        <div>
          <label className={label}>Stop-pris</label>
          <input className={inp} type="number" step="0.01" placeholder="115.00" value={form.stopPrice} onChange={e => set("stopPrice", e.target.value)} />
        </div>
        <div>
          <label className={label}>Målkurs (target)</label>
          <input className={inp} type="number" step="0.01" placeholder="145.00" value={form.targetPrice} onChange={e => set("targetPrice", e.target.value)} />
        </div>
        <div className="sm:col-span-1">
          <label className={label}>Anteckning</label>
          <input className={inp} placeholder="Valfri kommentar…" value={form.notes} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
      {error && (
        <div className="mb-3 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />{error}
        </div>
      )}
      <button
        onClick={submit}
        disabled={submitting}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Lägg till
      </button>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────
export function Portfolio() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PortfolioData>({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const res = await fetch(api("/portfolio"));
      if (!res.ok) throw new Error("Kunde inte hämta portfölj");
      return res.json();
    },
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`/portfolio/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Borttagning misslyckades");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });

  const onAdded = useCallback(() => {
    setShowForm(false);
    qc.invalidateQueries({ queryKey: ["portfolio"] });
  }, [qc]);

  const positions = data?.positions ?? [];
  const longs = positions.filter(p => p.direction === "LONG");
  const shorts = positions.filter(p => p.direction === "SHORT");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* header */}
      <header className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Briefcase className="h-7 w-7 text-muted-foreground" />
            Nuvarande portfölj
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Öppna positioner med live-kurs, orealiserat P&L och avstånd till stop/target.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Uppdatera
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md font-medium transition-colors ${
              showForm
                ? "bg-muted text-foreground border border-border"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            <Plus className="h-4 w-4" />
            {showForm ? "Avbryt" : "Ny position"}
          </button>
        </div>
      </header>

      {/* add form */}
      {showForm && <AddPositionForm onSuccess={onAdded} />}

      {/* loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />)}
        </div>
      )}

      {isError && (
        <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20 text-sm">
          Kunde inte hämta portföljdata. Prova att uppdatera.
        </div>
      )}

      {/* summary */}
      {data && positions.length > 0 && (
        <SummaryBar summary={data.summary} />
      )}

      {/* empty state */}
      {data && positions.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center h-64 bg-card border border-border rounded-lg text-muted-foreground gap-3">
          <Briefcase className="h-12 w-12 opacity-20" />
          <p className="text-base">Inga öppna positioner</p>
          <p className="text-sm opacity-70">Klicka på "Ny position" för att lägga till en trade.</p>
        </div>
      )}

      {/* longs */}
      {longs.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <TrendingUp className="h-4 w-4 text-success" /> Köp-positioner ({longs.length})
          </h3>
          {longs.map(pos => (
            <PositionCard key={pos.id} pos={pos} onDelete={id => deleteMutation.mutate(id)} />
          ))}
        </section>
      )}

      {/* shorts */}
      {shorts.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <TrendingDown className="h-4 w-4 text-destructive" /> Sälj-positioner ({shorts.length})
          </h3>
          {shorts.map(pos => (
            <PositionCard key={pos.id} pos={pos} onDelete={id => deleteMutation.mutate(id)} />
          ))}
        </section>
      )}
    </div>
  );
}
