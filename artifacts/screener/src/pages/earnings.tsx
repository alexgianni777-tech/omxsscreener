import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, CalendarDays, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { formatNumber, formatPercent } from "../lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface HistoricalEarning {
  date: string;
  estimate: number | null;
  actual: number | null;
  surprisePct: number | null;
  dayPlusOneReturn: number | null;
  beat: boolean | null;
}
interface EarningsStock {
  ticker: string;
  yahooTicker: string;
  display: string;
  market: "SE" | "US";
  earningsDate: string | null;
  earningsInDays: number | null;
  livePrice: number | null;
  changePct: number | null;
  nextEpsEstimate: number | null;
  beatRate: number | null;
  avgSurprisePct: number | null;
  avgDayPlusOneReturn: number | null;
  revisionUpCount: number;
  revisionDownCount: number;
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  targetMeanPrice: number | null;
  targetLowPrice: number | null;
  targetHighPrice: number | null;
  upsidePct: number | null;
  compositeScore: number | null;
  historicalEarnings: HistoricalEarning[];
}
interface EarningsResponse {
  stocks: EarningsStock[];
  generatedAt: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────
function useEarningsScreener() {
  return useQuery<EarningsResponse>({
    queryKey: ["earnings-screener"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/screener/earnings-screener`);
      if (!res.ok) throw new Error("Failed to load earnings screener");
      return res.json();
    },
    staleTime: 10 * 60_000, // 10 minutes — Yahoo Finance data doesn't update that often
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function Earnings() {
  const { data, isLoading, isError, refetch, isFetching } = useEarningsScreener();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <CalendarDays className="h-7 w-7 text-muted-foreground" />
            Rapport-screener
          </h2>
          <p className="text-muted-foreground mt-1">
            OMXS30 + EdgeAI US-aktier med rapport inom ±7 dagar. Historisk data — ingen teknisk signal.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Uppdatera
        </button>
      </header>

      {/* Disclaimer */}
      <div className="flex gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-700 dark:text-amber-400">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <strong>OBS:</strong> Denna sida visar historiska fundamentala mönster (beat-rate, EPS-surprise,
          prisreaktion dag +1) — <em>inte</em> tekniska signaler. EdgeAI känner inte till rapportdatum.
          Ta inga positioner enbart baserat på detta. Dag +1-avkastning är bakåtblickande och garanterar ingenting.
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm animate-pulse">
            Hämtar rapportdata för ~30 bolag… kan ta 20–40 sek första gången.
          </p>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
          Kunde inte hämta rapportdata. Prova att uppdatera.
        </div>
      )}

      {data && data.stocks.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 bg-card border border-border rounded-lg text-muted-foreground gap-3">
          <CalendarDays className="h-12 w-12 opacity-20" />
          <p className="text-base">Inga bolag rapporterar inom 21 dagar just nu.</p>
          <p className="text-sm opacity-70">Kolla igen närmre rapportsäsongen.</p>
        </div>
      )}

      {data && data.stocks.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {data.stocks.length} bolag hittade · uppdaterad {new Date(data.generatedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
          </p>
          {data.stocks.map((stock) => (
            <EarningsCard key={stock.yahooTicker} stock={stock} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function EarningsCard({ stock }: { stock: EarningsStock }) {
  const isToday = stock.earningsInDays === 0;
  const isTomorrow = stock.earningsInDays === 1;
  const isPast = (stock.earningsInDays ?? 1) < 0;

  const dayLabel = isPast
    ? `Rapporterade för ${Math.abs(stock.earningsInDays!)} dag${Math.abs(stock.earningsInDays!) === 1 ? "" : "ar"} sedan`
    : isToday
    ? "Rapporterar IDAG"
    : isTomorrow
    ? "Rapporterar IMORGON"
    : `Rapporterar om ${stock.earningsInDays} dagar`;

  const urgencyClass = isPast
    ? "border-border"
    : isToday
    ? "border-destructive/60 ring-1 ring-destructive/20"
    : isTomorrow || (stock.earningsInDays ?? 99) <= 2
    ? "border-orange-500/50"
    : "border-amber-500/30";

  const beatColor =
    stock.beatRate == null
      ? "text-muted-foreground"
      : stock.beatRate >= 0.7
      ? "text-success"
      : stock.beatRate >= 0.5
      ? "text-amber-600"
      : "text-destructive";

  const d1Color =
    stock.avgDayPlusOneReturn == null
      ? "text-muted-foreground"
      : stock.avgDayPlusOneReturn > 0
      ? "text-success"
      : "text-destructive";

  return (
    <div className={`bg-card border rounded-lg shadow-sm p-5 ${urgencyClass}`}>
      {/* Top row */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-xl">{stock.ticker}</span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
              {stock.market}
            </span>
            {stock.recommendationKey && (
              <Consensusbadge rkey={stock.recommendationKey} nAnalysts={stock.numberOfAnalystOpinions} />
            )}
            {(isToday || isTomorrow) && (
              <span className="flex items-center gap-1 text-xs font-bold text-orange-500">
                <AlertTriangle className="h-3 w-3" />
                Undvik ny position
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">{stock.display}</div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`text-xs font-bold px-2 py-1 rounded ${
            isPast ? "bg-muted text-muted-foreground" :
            isToday ? "bg-destructive/15 text-destructive" :
            isTomorrow ? "bg-orange-500/15 text-orange-500" :
            "bg-amber-500/10 text-amber-600"
          }`}>
            {dayLabel}
          </div>
          {stock.earningsDate && (
            <div className="text-xs text-muted-foreground mt-1">{stock.earningsDate}</div>
          )}
          {stock.compositeScore != null && (
            <div className="text-xs text-muted-foreground mt-1">
              Score: <span className={`font-mono font-bold ${stock.compositeScore >= 0.65 ? "text-success" : stock.compositeScore >= 0.45 ? "text-amber-600" : "text-muted-foreground"}`}>
                {Math.round(stock.compositeScore * 100)}
              </span>/100
            </div>
          )}
        </div>
      </div>

      {/* Live price + price target row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm mb-3">
        {stock.livePrice != null && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Pris</span>
            <span className="font-mono font-bold">{formatNumber(stock.livePrice)}</span>
            {stock.changePct != null && (
              <span className={`text-xs font-mono ${stock.changePct >= 0 ? "text-success" : "text-destructive"}`}>
                {stock.changePct >= 0 ? "+" : ""}{formatNumber(stock.changePct, 2)}%
              </span>
            )}
          </div>
        )}
        {stock.targetMeanPrice != null && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Kursmål</span>
            <span className="font-mono font-medium">{formatNumber(stock.targetMeanPrice)}</span>
            {stock.targetLowPrice != null && stock.targetHighPrice != null && (
              <span className="text-xs text-muted-foreground font-mono">
                ({formatNumber(stock.targetLowPrice)}–{formatNumber(stock.targetHighPrice)})
              </span>
            )}
            {stock.upsidePct != null && (
              <span className={`text-xs font-mono font-bold ${stock.upsidePct >= 0 ? "text-success" : "text-destructive"}`}>
                {stock.upsidePct >= 0 ? "+" : ""}{stock.upsidePct}%
              </span>
            )}
          </div>
        )}
        {stock.nextEpsEstimate != null && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">EPS-estimat</span>
            <span className="font-mono font-medium">{formatNumber(stock.nextEpsEstimate, 2)}</span>
          </div>
        )}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Metric
          label="Beat-rate"
          value={stock.beatRate != null ? formatPercent(stock.beatRate) : "–"}
          sub={`${stock.historicalEarnings.filter((e) => e.beat).length}/${stock.historicalEarnings.filter((e) => e.beat !== null).length} kvartal`}
          valueClass={beatColor}
        />
        <Metric
          label="Snitt EPS-surprise"
          value={stock.avgSurprisePct != null ? `${stock.avgSurprisePct > 0 ? "+" : ""}${formatNumber(stock.avgSurprisePct, 1)}%` : "–"}
          sub="mot estimat"
          valueClass={stock.avgSurprisePct != null ? (stock.avgSurprisePct > 0 ? "text-success" : "text-destructive") : "text-muted-foreground"}
        />
        <Metric
          label="Snitt dag +1"
          value={stock.avgDayPlusOneReturn != null ? `${stock.avgDayPlusOneReturn > 0 ? "+" : ""}${formatNumber(stock.avgDayPlusOneReturn, 1)}%` : "–"}
          sub="prisreaktion"
          valueClass={d1Color}
        />
        <Metric
          label="Rev. 30 dagar"
          value={`↑${stock.revisionUpCount} ↓${stock.revisionDownCount}`}
          sub="analytikerrevisioner"
          valueClass={
            stock.revisionUpCount > stock.revisionDownCount
              ? "text-success"
              : stock.revisionUpCount < stock.revisionDownCount
              ? "text-destructive"
              : "text-muted-foreground"
          }
        />
      </div>

      {/* Historical earnings mini-table */}
      {stock.historicalEarnings.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Senaste kvartalen</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stock.historicalEarnings.map((h) => (
              <div key={h.date} className={`rounded p-2 text-xs ${
                h.beat === true ? "bg-success/8" : h.beat === false ? "bg-destructive/8" : "bg-muted/50"
              }`}>
                <div className="text-muted-foreground text-[10px] mb-1">{h.date.slice(0, 7)}</div>
                <div className="flex justify-between items-center">
                  <span className="font-mono">
                    {h.actual != null ? formatNumber(h.actual, 2) : "?"}
                    <span className="text-muted-foreground"> / {h.estimate != null ? formatNumber(h.estimate, 2) : "?"}</span>
                  </span>
                  {h.beat !== null && (
                    h.beat
                      ? <TrendingUp className="h-3 w-3 text-success" />
                      : <TrendingDown className="h-3 w-3 text-destructive" />
                  )}
                </div>
                {h.dayPlusOneReturn != null && (
                  <div className={`text-[10px] font-mono mt-0.5 ${h.dayPlusOneReturn >= 0 ? "text-success" : "text-destructive"}`}>
                    dag+1: {h.dayPlusOneReturn >= 0 ? "+" : ""}{formatNumber(h.dayPlusOneReturn, 1)}%
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, valueClass = "" }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="bg-muted/40 rounded-md p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${valueClass}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// ── Analyst consensus pill ────────────────────────────────────────────────────
const CONSENSUS_CONFIG: Record<string, { label: string; cls: string }> = {
  strong_buy:  { label: "STRONG BUY",  cls: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30" },
  buy:         { label: "BUY",         cls: "bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30" },
  hold:        { label: "HOLD",        cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30" },
  sell:        { label: "SELL",        cls: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30" },
  strong_sell: { label: "STRONG SELL", cls: "bg-red-600/20 text-red-700 dark:text-red-400 border border-red-600/40" },
  underperform:{ label: "UNDERPERFORM",cls: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30" },
  outperform:  { label: "OUTPERFORM",  cls: "bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30" },
};

function Consensusbadge({ rkey, nAnalysts }: { rkey: string; nAnalysts: number | null }) {
  const cfg = CONSENSUS_CONFIG[rkey.toLowerCase()] ?? { label: rkey.replace(/_/g, " ").toUpperCase(), cls: "bg-muted text-muted-foreground border border-border" };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${cfg.cls}`}>
      {cfg.label}
      {nAnalysts != null && <span className="font-normal opacity-70">({nAnalysts})</span>}
    </span>
  );
}
