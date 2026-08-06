/**
 * CandlestickChart — lightweight-charts v5 with Bollinger Bands overlay.
 * Shows 90 days of daily OHLC candles + BB(20, 2σ).
 * Optional entry / stop / target dashed price-lines for session-detail view.
 */
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  CrosshairMode,
} from "lightweight-charts";
import { Loader2 } from "lucide-react";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface BBPoint {
  time: string;
  value: number;
}

interface PriceChartData {
  ticker: string;
  candles: Candle[];
  bollinger: { upper: BBPoint[]; middle: BBPoint[]; lower: BBPoint[] };
}

interface Props {
  ticker: string;
  entryPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  height?: number;
}

export function CandlestickChart({
  ticker,
  entryPrice,
  stopPrice,
  targetPrice,
  height = 340,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PriceChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    fetch(`/api/screener/price-chart/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.error ?? "error"))))
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [ticker]);

  useEffect(() => {
    if (!data || !containerRef.current) return;

    const isDark = document.documentElement.classList.contains("dark");
    const textColor = isDark ? "#9ca3af" : "#6b7280";
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

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

    // ── Candlestick ───────────────────────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(data.candles);

    // ── Bollinger Bands ───────────────────────────────────────────────────────
    const upperSeries = chart.addSeries(LineSeries, {
      color: "#818cf8",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    upperSeries.setData(data.bollinger.upper);

    const middleSeries = chart.addSeries(LineSeries, {
      color: "#a78bfa",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      title: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    middleSeries.setData(data.bollinger.middle);

    const lowerSeries = chart.addSeries(LineSeries, {
      color: "#818cf8",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    lowerSeries.setData(data.bollinger.lower);

    // ── Trade-plan price lines ────────────────────────────────────────────────
    if (entryPrice) {
      candleSeries.createPriceLine({
        price: entryPrice,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Entry",
      });
    }
    if (stopPrice) {
      candleSeries.createPriceLine({
        price: stopPrice,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Stop",
      });
    }
    if (targetPrice) {
      candleSeries.createPriceLine({
        price: targetPrice,
        color: "#10b981",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "Target",
      });
    }

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, entryPrice, stopPrice, targetPrice, height]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-muted-foreground" style={{ height }}>
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

  return (
    <div className="w-full rounded-md overflow-hidden border border-border/50">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-3 py-1.5 bg-muted/40 text-[10px] text-muted-foreground border-b border-border/50">
        <span className="font-semibold text-foreground/70 text-[11px]">
          {data.ticker} · 90d
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-6 bg-purple-400/70 border-t border-dashed border-purple-400" />
          BB(20, 2σ)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-6 bg-purple-500" />
          SMA 20
        </span>
        {entryPrice && (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-6 border-t border-dashed border-green-500" />
            Entry {entryPrice}
          </span>
        )}
        {stopPrice && (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-6 border-t border-dashed border-red-500" />
            Stop {stopPrice}
          </span>
        )}
        {targetPrice && (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-6 border-t border-dotted border-emerald-500" />
            Target {targetPrice}
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
