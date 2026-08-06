/**
 * CandlestickChart — lightweight-charts v5 with Bollinger Bands overlay,
 * volume histogram sub-pane, RSI(14) sub-pane, and a 1M / 3M / 6M timeframe picker.
 */
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  CrosshairMode,
} from "lightweight-charts";
import { Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface DataPoint {
  time: string;
  value: number;
}

interface PriceChartData {
  ticker: string;
  candles: Candle[];
  bollinger: { upper: DataPoint[]; middle: DataPoint[]; lower: DataPoint[] };
  rsi: DataPoint[];
}

type Timeframe = "1M" | "3M" | "6M";
const DAYS: Record<Timeframe, number> = { "1M": 30, "3M": 90, "6M": 180 };

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  ticker: string;
  entryPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  /** Total chart height (all panes combined). Default 500. */
  height?: number;
}

export function CandlestickChart({
  ticker,
  entryPrice,
  stopPrice,
  targetPrice,
  height = 500,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("3M");
  const [data, setData] = useState<PriceChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    const days = DAYS[timeframe];
    fetch(`/api/screener/price-chart/${encodeURIComponent(ticker)}?days=${days}`)
      .then((r) =>
        r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.error ?? "error")),
      )
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [ticker, timeframe]);

  // ── Chart ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!data || !containerRef.current) return;

    const isDark = document.documentElement.classList.contains("dark");
    const textColor = isDark ? "#9ca3af" : "#6b7280";
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

    // Pane height distribution
    const mainH  = Math.round(height * 0.56);
    const volH   = Math.round(height * 0.18);
    const rsiH   = height - mainH - volH;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: "transparent" }, textColor },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth,
      height,
      rightPriceScale: { borderColor: "rgba(100,100,100,0.15)" },
      timeScale: { borderColor: "rgba(100,100,100,0.15)", timeVisible: false },
    });

    // ── Pane 0: Candlestick ───────────────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:       "#22c55e",
      downColor:     "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor:   "#22c55e",
      wickDownColor: "#ef4444",
    }, 0);
    candleSeries.setData(data.candles);

    // BB upper
    chart.addSeries(LineSeries, {
      color: "#818cf8", lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "", lastValueVisible: false, priceLineVisible: false,
    }, 0).setData(data.bollinger.upper);

    // BB middle (SMA 20)
    chart.addSeries(LineSeries, {
      color: "#a78bfa", lineWidth: 1,
      lineStyle: LineStyle.Solid,
      title: "", lastValueVisible: false, priceLineVisible: false,
    }, 0).setData(data.bollinger.middle);

    // BB lower
    chart.addSeries(LineSeries, {
      color: "#818cf8", lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "", lastValueVisible: false, priceLineVisible: false,
    }, 0).setData(data.bollinger.lower);

    // Trade-plan price lines
    if (entryPrice) {
      candleSeries.createPriceLine({
        price: entryPrice, color: "#22c55e", lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry",
      });
    }
    if (stopPrice) {
      candleSeries.createPriceLine({
        price: stopPrice, color: "#ef4444", lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Stop",
      });
    }
    if (targetPrice) {
      candleSeries.createPriceLine({
        price: targetPrice, color: "#10b981", lineWidth: 1,
        lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "Target",
      });
    }

    // ── Pane 1: Volume histogram ──────────────────────────────────────────────
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1);

    const volData = data.candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
    }));
    volSeries.setData(volData);

    // ── Pane 2: RSI(14) ───────────────────────────────────────────────────────
    const rsiSeries = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 1,
      title: "",
      lastValueVisible: true,
      priceLineVisible: false,
    }, 2);

    if (data.rsi && data.rsi.length > 0) {
      rsiSeries.setData(data.rsi);
    }

    // Reference lines at 70 (overbought) and 30 (oversold)
    rsiSeries.createPriceLine({
      price: 70, color: "rgba(239,68,68,0.55)", lineWidth: 1,
      lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "OB",
    });
    rsiSeries.createPriceLine({
      price: 30, color: "rgba(34,197,94,0.55)", lineWidth: 1,
      lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "OS",
    });
    rsiSeries.createPriceLine({
      price: 50, color: "rgba(100,100,100,0.25)", lineWidth: 1,
      lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "",
    });

    // ── Fit & set pane heights ────────────────────────────────────────────────
    chart.timeScale().fitContent();

    try {
      const panes = (chart as any).panes?.();
      if (panes && panes.length >= 3) {
        panes[0].setHeight(mainH);
        panes[1].setHeight(volH);
        panes[2].setHeight(rsiH);
      }
    } catch {
      // Silently ignore if pane height API unavailable
    }

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, entryPrice, stopPrice, targetPrice, height]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex items-center justify-center gap-2 text-muted-foreground"
        style={{ height }}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Laddar kursdata...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center text-sm text-destructive/80 py-4">
        Kursdatafel: {error}
      </div>
    );
  }

  if (!data) return null;

  // Current RSI value for legend
  const lastRSI = data.rsi?.at(-1)?.value;
  const rsiColor =
    lastRSI == null ? "text-muted-foreground"
    : lastRSI >= 70  ? "text-red-400"
    : lastRSI <= 30  ? "text-green-400"
    : "text-amber-400";

  return (
    <div className="w-full rounded-md overflow-hidden border border-border/50">
      {/* ── Legend bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 bg-muted/40 text-[10px] text-muted-foreground border-b border-border/50">
        {/* Ticker */}
        <span className="font-semibold text-foreground/70 text-[11px]">
          {data.ticker}
        </span>

        {/* Timeframe picker */}
        <div className="flex items-center gap-0.5">
          {(["1M", "3M", "6M"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={[
                "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                timeframe === tf
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* BB legend */}
        <span className="flex items-center gap-1.5">
          <span className="h-px w-5 bg-purple-400/70 border-t border-dashed border-purple-400" />
          BB(20, 2σ)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-5 bg-purple-500" />
          SMA 20
        </span>

        {/* RSI legend */}
        <span className="flex items-center gap-1.5">
          <span className="h-px w-5 bg-amber-400" />
          <span className={rsiColor}>
            RSI 14{lastRSI != null ? ` · ${lastRSI.toFixed(1)}` : ""}
          </span>
        </span>

        {/* Trade plan lines */}
        {entryPrice && (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 border-t border-dashed border-green-500" />
            Entry {entryPrice}
          </span>
        )}
        {stopPrice && (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 border-t border-dashed border-red-500" />
            Stop {stopPrice}
          </span>
        )}
        {targetPrice && (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 border-t border-dotted border-emerald-500" />
            Target {targetPrice}
          </span>
        )}
      </div>

      {/* ── Chart canvas ────────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
