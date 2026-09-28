import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetPortfolioQueryKey, useGetPortfolio,
  type PortfolioPosition, type PortfolioResponse,
} from "@workspace/api-client-react";
import {
  Briefcase, TrendingUp, TrendingDown, RefreshCw, Plus, Trash2,
  AlertTriangle, Target, ShieldAlert, ChevronUp, ChevronDown, ClipboardPaste, CheckCircle2, Pencil, X,
} from "lucide-react";
import { parseBrokerExport, type BrokerImportRow } from "../lib/portfolioBrokerParser";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}/api${path}`;

// ── types ──────────────────────────────────────────────────────────────────────
type Position = PortfolioPosition;
type PortfolioData = PortfolioResponse;

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

/** Human-readable "how long ago" for a timestamp, in Swedish. */
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just nu";
  if (minutes < 60) return `${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  return `${days} dygn sedan`;
}

function timeOfDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

/** Staleness tier for a quote/valuation timestamp, used to color the freshness badge. */
function freshnessTier(iso: string | null): "fresh" | "stale" | "very-stale" | "unknown" {
  if (!iso) return "unknown";
  const minutes = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (!isFinite(minutes)) return "unknown";
  if (minutes <= 15) return "fresh";
  if (minutes <= 60) return "stale";
  return "very-stale";
}

const FRESHNESS_STYLE: Record<ReturnType<typeof freshnessTier>, string> = {
  fresh: "text-success bg-success/10 border-success/20",
  stale: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  "very-stale": "text-destructive bg-destructive/10 border-destructive/20",
  unknown: "text-muted-foreground bg-muted border-border",
};

// ── summary card ───────────────────────────────────────────────────────────────
function FreshnessBadge({ iso, label }: { iso: string | null; label: string }) {
  const tier = freshnessTier(iso);
  const ago = timeAgo(iso);
  const at = timeOfDay(iso);
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${FRESHNESS_STYLE[tier]}`}
      title={at ? `${label} kl ${at}` : label}
    >
      <RefreshCw className="h-2.5 w-2.5" />
      {ago ? `${label} ${ago}` : `${label} okänd`}
    </span>
  );
}

function SummaryBar({ summary, fetchedAt }: { summary: PortfolioData["summary"]; fetchedAt: string }) {
  const isUp = summary.totalUnrealisedKr >= 0;
  const netLong = summary.netExposureKr >= 0;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <FreshnessBadge iso={fetchedAt} label="Portföljvärdet beräknat" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
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
        <Tile
          label="Max stopförlust"
          value={summary.maxStopLossKr == null ? "Odefinierad" : `${sgn(-summary.maxStopLossKr, 0)} kr`}
          sub={summary.maxStopLossKr == null ? "Minst en position saknar stop" : "Endast negativ nedsida vid stop"}
          valueClass={summary.maxStopLossKr == null ? "text-amber-500" : "text-destructive"}
        />
        <Tile label="Long-exponering" value={`${fmt(summary.longExposureKr)} kr`} valueClass="text-success" />
        <Tile label="Short-exponering" value={`${fmt(summary.shortExposureKr)} kr`} valueClass="text-destructive" />
        <Tile
          label="Underliggande riktning"
          value={`L ${fmt(summary.underlyingLongCount, 0)} · S ${fmt(summary.underlyingShortCount, 0)}`}
          sub={`${fmt(summary.underlyingDirectionUnknownCount, 0)} okända · nominell exponering ej beräknad`}
        />
        <Tile label="Bruttoexponering" value={`${fmt(summary.grossExposureKr)} kr`} />
        <Tile
          label="Nettoexponering"
          value={`${sgn(summary.netExposureKr, 0)} kr`}
          sub={netLong ? "Netto long" : "Netto short"}
          valueClass={netLong ? "text-success" : "text-destructive"}
        />
      </div>
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
  const isShort = (pos.productSide ?? pos.direction) === "SHORT";
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

// ── edit-position form (in-place, no delete + re-add) ───────────────────────────
function EditPositionForm({ pos, onCancel, onSuccess }: { pos: Position; onCancel: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    ticker: pos.ticker,
    instrument: pos.instrument ?? "",
    direction: pos.direction,
    productType: pos.productType ?? "",
    productSide: pos.productSide ?? "",
    underlyingDirection: pos.underlyingDirection ?? "",
    underlyingTicker: pos.underlyingTicker ?? "",
    indicativeLeverage: pos.indicativeLeverage != null ? String(pos.indicativeLeverage) : "",
    financingLevel: pos.financingLevel != null ? String(pos.financingLevel) : "",
    barrierLevel: pos.barrierLevel != null ? String(pos.barrierLevel) : "",
    barrierType: pos.barrierType ?? "",
    entryPrice: String(pos.entryPrice),
    shares: String(pos.shares),
    stopPrice: pos.stopPrice != null ? String(pos.stopPrice) : "",
    targetPrice: pos.targetPrice != null ? String(pos.targetPrice) : "",
    market: (pos.market as "SE" | "US" | null) ?? "SE",
    notes: pos.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.ticker.trim() || !form.entryPrice || !form.shares) {
      setError("Ticker, entrypris och antal aktier krävs.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(api(`/portfolio/${pos.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: form.ticker.trim().toUpperCase(),
          instrument: form.instrument.trim() || null,
          direction: form.direction,
          productType: form.productType.trim() || null,
          productSide: form.productSide || null,
          underlyingDirection: form.underlyingDirection || null,
          underlyingTicker: form.underlyingTicker.trim() || null,
          indicativeLeverage: form.indicativeLeverage ? parseFloat(form.indicativeLeverage) : null,
          financingLevel: form.financingLevel ? parseFloat(form.financingLevel) : null,
          barrierLevel: form.barrierLevel ? parseFloat(form.barrierLevel) : null,
          barrierType: form.barrierType.trim() || null,
          entryPrice: parseFloat(form.entryPrice),
          shares: parseFloat(form.shares),
          stopPrice: form.stopPrice ? parseFloat(form.stopPrice) : null,
          targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
          market: form.market || null,
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Fel ${res.status}`);
        return;
      }
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
    <div className="bg-card border border-primary/30 rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Pencil className="h-4 w-4 text-primary" /> Redigera {pos.ticker}
        </h3>
        <button onClick={onCancel} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label className={label}>Ticker</label>
          <input className={inp} value={form.ticker} onChange={e => set("ticker", e.target.value)} />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label className={label}>Köpt verktyg</label>
          <input className={inp} value={form.instrument} onChange={e => set("instrument", e.target.value)} />
        </div>
        <div>
          <label className={label}>Riktning</label>
          <select className={inp} value={form.direction} onChange={e => set("direction", e.target.value as "LONG" | "SHORT")}>
            <option value="LONG">▲ LONG</option>
            <option value="SHORT">▼ SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Produkttyp</label>
          <input className={inp} placeholder="TURBO" value={form.productType} onChange={e => set("productType", e.target.value)} />
        </div>
        <div>
          <label className={label}>Ägd produkt</label>
          <select className={inp} value={form.productSide} onChange={e => set("productSide", e.target.value)}>
            <option value="">Okänd / legacy</option>
            <option value="LONG">LONG (äger produkten)</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Underliggande riktning</label>
          <select className={inp} value={form.underlyingDirection} onChange={e => set("underlyingDirection", e.target.value)}>
            <option value="">Okänd</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Underliggande ticker</label>
          <input className={inp} value={form.underlyingTicker} onChange={e => set("underlyingTicker", e.target.value)} />
        </div>
        <div>
          <label className={label}>Indikativ hävstång</label>
          <input className={inp} type="number" step="0.1" min="0" value={form.indicativeLeverage} onChange={e => set("indicativeLeverage", e.target.value)} />
        </div>
        <div>
          <label className={label}>Finansieringsnivå</label>
          <input className={inp} type="number" step="0.01" min="0" value={form.financingLevel} onChange={e => set("financingLevel", e.target.value)} />
        </div>
        <div>
          <label className={label}>Barriärnivå</label>
          <input className={inp} type="number" step="0.01" min="0" value={form.barrierLevel} onChange={e => set("barrierLevel", e.target.value)} />
        </div>
        <div>
          <label className={label}>Barriärtyp</label>
          <input className={inp} placeholder="Knock-out" value={form.barrierType} onChange={e => set("barrierType", e.target.value)} />
        </div>
        <div>
          <label className={label}>Marknad</label>
          <select className={inp} value={form.market ?? "SE"} onChange={e => set("market", e.target.value as "SE" | "US")}>
            <option value="SE">SE</option>
            <option value="US">US</option>
          </select>
        </div>
        <div>
          <label className={label}>Antal aktier</label>
          <input className={inp} type="number" value={form.shares} onChange={e => set("shares", e.target.value)} />
        </div>
        <div>
          <label className={label}>Entry-pris</label>
          <input className={inp} type="number" step="0.01" value={form.entryPrice} onChange={e => set("entryPrice", e.target.value)} />
        </div>
        <div>
          <label className={label}>Stop-pris</label>
          <input className={inp} type="number" step="0.01" value={form.stopPrice} onChange={e => set("stopPrice", e.target.value)} />
        </div>
        <div>
          <label className={label}>Målkurs (target)</label>
          <input className={inp} type="number" step="0.01" value={form.targetPrice} onChange={e => set("targetPrice", e.target.value)} />
        </div>
        <div className="sm:col-span-1">
          <label className={label}>Anteckning</label>
          <input className={inp} value={form.notes} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
      {error && (
        <div className="mb-3 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />{error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Spara ändringar
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:bg-muted transition-colors"
        >
          Avbryt
        </button>
      </div>
    </div>
  );
}

// ── single position card ───────────────────────────────────────────────────────
function PositionCard({ pos, onDelete, onEdited }: { pos: Position; onDelete: (id: number) => void; onEdited: () => void }) {
  const isShort = pos.direction === "SHORT";
  const pnlUp = (pos.unrealisedKr ?? 0) >= 0;
  const rVal = pos.currentR ?? 0;
  const rColor = rVal >= 1 ? "text-success" : rVal <= -0.5 ? "text-destructive" : "text-amber-500";
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <EditPositionForm pos={pos} onCancel={() => setEditing(false)} onSuccess={() => { setEditing(false); onEdited(); }} />;
  }

  return (
    <div className={`bg-card border rounded-lg p-5 shadow-sm transition-colors ${
      pnlUp ? "border-success/20" : (pos.unrealisedKr ?? 0) < 0 ? "border-destructive/20" : "border-border"
    }`}>
      {/* header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-xl tracking-tight">{pos.ticker}</span>
          {pos.instrument && (
            <span className="text-xs text-muted-foreground border-l border-border pl-2">
              {pos.instrument}
            </span>
          )}
          {pos.productType && (
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {pos.productType}
            </span>
          )}
          {pos.productSide && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              Ägd produkt {pos.productSide}
            </span>
          )}
          {pos.underlyingDirection && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              pos.underlyingDirection === "LONG" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            }`}>
              Underliggande {pos.underlyingDirection}{pos.underlyingTicker ? ` · ${pos.underlyingTicker}` : ""}
            </span>
          )}
          {pos.instrument && (!pos.productSide || !pos.underlyingDirection) && (
            <span className="text-[10px] text-amber-500">Instrumentdata okänd</span>
          )}
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
              {pos.instrument || pos.productType ? (
                <div className="text-[10px] text-muted-foreground">Senast importerat</div>
              ) : pos.changePct != null && (
                <div className={`text-xs font-mono flex items-center justify-end gap-0.5 ${
                  pos.changePct >= 0 ? "text-success" : "text-destructive"
                }`}>
                  {pos.changePct >= 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {Math.abs(pos.changePct).toFixed(2)}%
                </div>
              )}
              {!pos.instrument && !pos.productType && (
                <div className="mt-1">
                  <FreshnessBadge iso={pos.quoteAsOf} label="Kurs" />
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
            onClick={() => setEditing(true)}
            className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Redigera position"
          >
            <Pencil className="h-4 w-4" />
          </button>
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
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-x-4 gap-y-2 mt-3 text-xs">
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
        {pos.indicativeLeverage != null && (
          <MetricCell label="Indikativ hävstång" value={`${fmt(pos.indicativeLeverage, 1)}×`} sub="Påverkar inte P&L-beräkningen" />
        )}
        {pos.financingLevel != null && <MetricCell label="Finansieringsnivå" value={fmt(pos.financingLevel, 2)} />}
        {pos.barrierLevel != null && <MetricCell label={pos.barrierType || "Barriär"} value={fmt(pos.barrierLevel, 2)} />}
        {!pos.underlyingDirection && pos.instrument && (
          <MetricCell label="Underliggande exponering" value="Okänd" sub="Notional kräver ratio och underliggande kurs" />
        )}
        <MetricCell
          label="P&L vid stop"
          value={pos.stopPnlKr != null ? `${sgn(pos.stopPnlKr, 0)} kr` : "Ingen stop"}
          sub={pos.stopPnlPct != null ? `${sgn(pos.stopPnlPct, 1)}% av entry` : undefined}
          valueClass={pos.stopPnlKr != null ? (pos.stopPnlKr >= 0 ? "text-success" : "text-destructive") : "text-muted-foreground"}
          icon={<ShieldAlert className="h-3 w-3 text-destructive/60" />}
        />
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

function BrokerImport({ onSuccess }: { onSuccess: () => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BrokerImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const analyze = () => {
    const parsed = parseBrokerExport(text);
    setRows(parsed.rows);
    setError(parsed.errors.length > 0 ? parsed.errors.join(" ") : null);
    setSuccess(null);
  };

  const setTicker = (id: string, ticker: string) => {
    setRows(current => current.map(row => row.id === id ? { ...row, ticker } : row));
    setError(null);
  };

  const submit = async () => {
    if (rows.some(row => !row.ticker.trim())) {
      setError("Fyll i aktiens ticker för varje instrument innan importen bekräftas.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(api("/portfolio/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: rows.map(row => ({
            ticker: row.ticker.trim().toUpperCase(),
            instrument: row.instrument,
            direction: row.direction,
            productSide: row.productSide,
            underlyingDirection: row.underlyingDirection,
            entryPrice: row.entryPrice,
            lastPrice: row.livePrice,
            shares: row.shares,
            market: null,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Importen misslyckades (${res.status})`);
        return;
      }
      setSuccess(`${body.updated} uppdaterade och ${body.created} nya positioner.`);
      setText("");
      setRows([]);
      onSuccess();
    } catch (e: any) {
      setError(e.message ?? "Nätverksfel vid importen");
    } finally {
      setSubmitting(false);
    }
  };

  const inp = "w-full bg-background border border-border rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const label = "text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block";

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardPaste className="h-4 w-4 text-primary" /> Importera från Avanza
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Klistra in hela tabellen. Instrumenten läses automatiskt; ange bara underliggande akties ticker i förhandsvisningen.
        </p>
      </div>
      <textarea
        className={`${inp} min-h-36 font-mono text-xs`}
        placeholder={"MINI L HEXAGON AVA 32\n77\t+1,16%\t10:37\t40,26\t38,86 SEK\t+108 kr\t+3,60%\t3 100 kr"}
        value={text}
        onChange={e => setText(e.target.value)}
        aria-label="Klistra in portföljtabell"
      />
      <button
        onClick={analyze}
        disabled={!text.trim()}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
      >
        <RefreshCw className="h-4 w-4" /> Analysera inklistring
      </button>

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Förhandsvisning ({rows.length} instrument)
            </h4>
            <span className="text-[11px] text-muted-foreground">Ticker krävs per rad</span>
          </div>
          {rows.map(row => (
            <div key={row.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem] gap-3 items-end p-3 rounded-md border border-border bg-background">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{row.instrument}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {fmt(row.shares, 0)} st · entry {fmt(row.entryPrice, 2)} · senast {fmt(row.livePrice, 2)} ·{" "}
                  <span className={row.pnlKr >= 0 ? "text-success" : "text-destructive"}>
                    {sgn(row.pnlKr, 0)} kr ({sgn(row.pnlPct, 2)}%)
                  </span>
                </div>
              </div>
              <div>
                <label className={label}>Aktiens ticker</label>
                <input
                  className={inp}
                  placeholder="HEXA-B"
                  value={row.ticker}
                  onChange={e => setTicker(row.id, e.target.value)}
                />
              </div>
            </div>
          ))}
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Uppdatera portfölj
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />{error}
        </div>
      )}
      {success && (
        <div className="text-xs text-success flex items-center gap-2">
          <CheckCircle2 className="h-3 w-3 shrink-0" />{success}
        </div>
      )}
    </div>
  );
}

// ── add-position form ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  ticker: "", instrument: "", direction: "LONG" as "LONG" | "SHORT",
  productType: "", productSide: "", underlyingDirection: "", underlyingTicker: "",
  indicativeLeverage: "", financingLevel: "", barrierLevel: "", barrierType: "",
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
          instrument: form.instrument.trim() || undefined,
          direction: form.direction,
          productType: form.productType.trim() || null,
          productSide: form.productSide || null,
          underlyingDirection: form.underlyingDirection || null,
          underlyingTicker: form.underlyingTicker.trim() || null,
          indicativeLeverage: form.indicativeLeverage ? parseFloat(form.indicativeLeverage) : null,
          financingLevel: form.financingLevel ? parseFloat(form.financingLevel) : null,
          barrierLevel: form.barrierLevel ? parseFloat(form.barrierLevel) : null,
          barrierType: form.barrierType.trim() || null,
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
        <div className="col-span-2 sm:col-span-2">
          <label className={label}>Köpt verktyg</label>
          <input
            className={inp}
            placeholder="MINI L HEXAGON AVA 32"
            value={form.instrument}
            onChange={e => set("instrument", e.target.value)}
          />
        </div>
        <div>
          <label className={label}>Riktning</label>
          <select className={inp} value={form.direction} onChange={e => set("direction", e.target.value as "LONG" | "SHORT")}>
            <option value="LONG">▲ LONG</option>
            <option value="SHORT">▼ SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Produkttyp</label>
          <input className={inp} placeholder="TURBO" value={form.productType} onChange={e => set("productType", e.target.value)} />
        </div>
        <div>
          <label className={label}>Ägd produkt</label>
          <select className={inp} value={form.productSide} onChange={e => set("productSide", e.target.value)}>
            <option value="">Okänd / legacy</option>
            <option value="LONG">LONG (äger produkten)</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Underliggande riktning</label>
          <select className={inp} value={form.underlyingDirection} onChange={e => set("underlyingDirection", e.target.value)}>
            <option value="">Okänd</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Underliggande ticker</label>
          <input className={inp} value={form.underlyingTicker} onChange={e => set("underlyingTicker", e.target.value)} />
        </div>
        <div>
          <label className={label}>Indikativ hävstång</label>
          <input className={inp} type="number" step="0.1" min="0" value={form.indicativeLeverage} onChange={e => set("indicativeLeverage", e.target.value)} />
        </div>
        <div>
          <label className={label}>Finansieringsnivå</label>
          <input className={inp} type="number" step="0.01" min="0" value={form.financingLevel} onChange={e => set("financingLevel", e.target.value)} />
        </div>
        <div>
          <label className={label}>Barriärnivå</label>
          <input className={inp} type="number" step="0.01" min="0" value={form.barrierLevel} onChange={e => set("barrierLevel", e.target.value)} />
        </div>
        <div>
          <label className={label}>Barriärtyp</label>
          <input className={inp} placeholder="Knock-out" value={form.barrierType} onChange={e => set("barrierType", e.target.value)} />
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
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useGetPortfolio({
    query: { queryKey: getGetPortfolioQueryKey(), staleTime: 60_000 },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`/portfolio/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Borttagning misslyckades");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getGetPortfolioQueryKey() }),
  });

  const onAdded = useCallback(() => {
    setShowForm(false);
    qc.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
  }, [qc]);

  const onImported = useCallback(() => {
    setShowImport(false);
    qc.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
  }, [qc]);

  const onEdited = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
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
            Öppna positioner med live-kurs eller senast importerade instrumentkurs, orealiserat P&L och avstånd till stop/target.
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
            onClick={() => setShowImport(v => !v)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors ${
              showImport ? "bg-muted text-foreground border-border" : "bg-card hover:bg-muted border-border"
            }`}
          >
            <ClipboardPaste className="h-4 w-4" />
            {showImport ? "Avbryt import" : "Importera Avanza"}
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
      {showImport && <BrokerImport onSuccess={onImported} />}

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
        <SummaryBar summary={data.summary} fetchedAt={data.fetchedAt} />
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
            <PositionCard key={pos.id} pos={pos} onDelete={id => deleteMutation.mutate(id)} onEdited={onEdited} />
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
            <PositionCard key={pos.id} pos={pos} onDelete={id => deleteMutation.mutate(id)} onEdited={onEdited} />
          ))}
        </section>
      )}
    </div>
  );
}
