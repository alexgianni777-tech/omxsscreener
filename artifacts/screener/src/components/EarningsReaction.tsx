import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getEarningsIntraday } from "@workspace/api-client-react";
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatNumber } from "../lib/utils";

export interface EarningsReactionData {
  status: "UPCOMING" | "AVAILABLE" | "MISSING" | "CONFLICT";
  reportDate: string | null;
  reportTimestamp: string | null;
  timezone: string;
  dataAsOf: string | null;
  previousClose: { date: string; close: number } | null;
  reportDay: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  } | null;
  changePct: { open: number; high: number; low: number; close: number } | null;
  postReport: Array<{
    sessions: 1 | 3 | 5;
    date: string | null;
    close: number | null;
    returnPct: number | null;
  }>;
  reason: string | null;
  priceHistoryStatus: "CURRENT" | "STALE" | "UNKNOWN";
  marketDataAsOf: string | null;
  source: string;
}

type IntradayResponse = Awaited<ReturnType<typeof getEarningsIntraday>>;

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "saknas";
  return `${new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatVolume(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "saknas"
    : new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(value);
}

function formatTimestamp(value: string | null, timezone: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "tidpunkt ej verifierad";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusText(status: EarningsReactionData["status"]): string {
  switch (status) {
    case "AVAILABLE": return "Data finns";
    case "CONFLICT": return "CONFLICT";
    case "MISSING": return "NO DATA";
    case "UPCOMING": return "KOMMANDE";
  }
}

export function EarningsReaction({
  ticker,
  yahooTicker,
  market,
  reaction,
  pageFetchedAt,
}: {
  ticker: string;
  yahooTicker: string;
  market: "SE" | "US";
  reaction: EarningsReactionData;
  pageFetchedAt: string;
}) {
  const [showIntraday, setShowIntraday] = useState(false);
  const query = useQuery<IntradayResponse>({
    queryKey: ["earnings-intraday", yahooTicker, reaction.reportDate, market],
    enabled: showIntraday && !!reaction.reportDate && reaction.status !== "UPCOMING",
    staleTime: 15 * 60_000,
    retry: false,
    queryFn: () => getEarningsIntraday({
        ticker: yahooTicker,
        reportDate: reaction.reportDate!,
        market,
      }),
  });

  const canLoadIntraday = !!reaction.reportDate && reaction.status !== "UPCOMING";

  return (
    <details className="mt-3 rounded-lg border border-border/70 bg-muted/20" data-testid={`earnings-reaction-${ticker}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-sm font-medium">
        <span>Verifierad kursrörelse</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          reaction.status === "CONFLICT"
            ? "bg-destructive/10 text-destructive"
            : reaction.status === "MISSING"
            ? "bg-muted text-muted-foreground"
            : reaction.status === "UPCOMING"
            ? "bg-primary/10 text-primary"
            : "bg-success/10 text-success"
        }`} data-testid={`earnings-reaction-status-${ticker}`}>{statusText(reaction.status)}</span>
        {reaction.priceHistoryStatus === "STALE" && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">STALE</span>
        )}
      </summary>

      <div className="space-y-3 border-t border-border/70 px-3 py-3 text-xs">
        <div className="grid gap-1 sm:grid-cols-2">
          <p>Rapportdag ({market}): <strong className="font-mono">{reaction.reportDate ?? "datum ej verifierat"}</strong></p>
          <p>Rapporttidpunkt från källan: <strong>{formatTimestamp(reaction.reportTimestamp, reaction.timezone)}</strong></p>
          <p>Senaste kursobservation: <strong>{formatTimestamp(reaction.marketDataAsOf, reaction.timezone)}</strong></p>
          <p>Källa: <strong>{reaction.source || "okänd"}</strong></p>
          <p>Kursdata as-of: <strong className="font-mono">{reaction.dataAsOf ?? "okänt"}</strong></p>
          <p>Rapportscreen hämtad: <strong>{formatTimestamp(pageFetchedAt, reaction.timezone)}</strong></p>
        </div>

        {reaction.priceHistoryStatus === "STALE" && (
          <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-amber-800 dark:text-amber-300">
            STALE: dagsserien slutar före senaste angivna kursdatum. Rörelsen visas endast där källdata finns.
          </p>
        )}
        {reaction.priceHistoryStatus === "UNKNOWN" && (
          <p role="status" className="rounded-md bg-muted px-2.5 py-2 text-muted-foreground">
            Färskhetsstatus okänd: jämförande kurs-tidsstämpel saknas.
          </p>
        )}
        {reaction.priceHistoryStatus === "CURRENT" && (
          <p role="status" className="rounded-md bg-success/5 px-2.5 py-2 text-muted-foreground">
            Dagsseriens datum överensstämmer med senaste angivna kursdatum. Detta är historik, inte en livekurs.
          </p>
        )}
        {reaction.status === "CONFLICT" && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-destructive">
            CONFLICT: {reaction.reason ?? "Källdata motsäger sig själv."} Beräknade nivåer visas inte.
          </p>
        )}
        {reaction.status === "MISSING" && (
          <p role="status" className="rounded-md bg-muted px-2.5 py-2 text-muted-foreground">
            NO DATA: {reaction.reason ?? "Historiska data saknas. Ingen närliggande dag används som ersättning."}
          </p>
        )}
        {reaction.status === "UPCOMING" && (
          <p role="status" className="rounded-md bg-muted px-2.5 py-2 text-muted-foreground">
            Rapporten har inte inträffat. Ingen kursreaktion eller minutdata visas ännu.
          </p>
        )}

        {reaction.reportDay && reaction.status !== "CONFLICT" && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <PriceMetric label="Föreg. stängning" value={reaction.previousClose?.close ?? null}
                sub={reaction.previousClose?.date ?? "saknas"} />
              <PriceMetric label="Öppning" value={reaction.reportDay.open} sub={`vs föreg. stängning ${formatPercent(reaction.changePct?.open)}`} />
              <PriceMetric label="Högsta" value={reaction.reportDay.high} sub={`vs föreg. stängning ${formatPercent(reaction.changePct?.high)}`} />
              <PriceMetric label="Lägsta" value={reaction.reportDay.low} sub={`vs föreg. stängning ${formatPercent(reaction.changePct?.low)}`} />
              <PriceMetric label="Stängning" value={reaction.reportDay.close} sub={`vs föreg. stängning ${formatPercent(reaction.changePct?.close)}`} />
            </div>
            <p className="text-muted-foreground">
              Volym rapportdagen: <strong className="font-mono text-foreground">{formatVolume(reaction.reportDay.volume)}</strong>
              {" · "}1/3/5 handelsdagar räknas från rapportdagens stängning.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {reaction.postReport.map((move) => (
                <div key={move.sessions} className="rounded-md border border-border/70 bg-card px-2.5 py-2">
                  <div className="text-muted-foreground">+{move.sessions} handelsdagar</div>
                  <div className="mt-1 font-mono font-semibold">
                    {move.returnPct == null ? "ej tillgänglig" : formatPercent(move.returnPct)}
                  </div>
                  <div className="text-muted-foreground">{move.date ?? "ofullständig historik"}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {canLoadIntraday && reaction.status !== "CONFLICT" && (
          <div className="space-y-2">
            <button type="button" onClick={() => setShowIntraday(true)} disabled={query.isFetching}
              className="min-h-10 rounded-md border border-border bg-card px-3 py-2 font-medium hover:bg-muted disabled:opacity-50"
              data-testid={`button-intraday-${ticker}`}>
              {query.isFetching ? "Hämtar minutdata…" : "Visa intradagsdiagram"}
            </button>
            <p className="text-muted-foreground">Minutdata hämtas först när du öppnar diagrammet; tidsstämplar visas i {reaction.timezone}.</p>
            {query.isError && <p role="alert" className="text-destructive">Minutdata kunde inte hämtas. Inga värden har uppskattats.</p>}
            {query.data?.status === "MISSING" && <p role="status" className="text-muted-foreground">Historisk minutdata saknas för rapportdagen.</p>}
            {query.data?.status === "CONFLICT" && <p role="alert" className="text-destructive">CONFLICT i minutserien. Diagrammet visas inte.</p>}
            {query.data?.status === "AVAILABLE" && (
              <IntradayChart
                candles={query.data.candles}
                timezone={query.data.timezone}
                source={query.data.source}
                fetchedAt={query.data.fetchedAt}
                asOf={query.data.asOf}
              />
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function PriceMetric({ label, value, sub }: { label: string; value: number | null; sub: string }) {
  return (
    <div className="min-w-0 rounded-md bg-card px-2.5 py-2">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold">{value == null ? "saknas" : formatNumber(value)}</div>
      <div className="mt-0.5 break-words text-[10px] leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  );
}

function IntradayChart({
  candles, timezone, source, fetchedAt, asOf,
}: {
  candles: IntradayResponse["candles"];
  timezone: string;
  source: string;
  fetchedAt: string;
  asOf: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const firstTime = candles[0]?.timestamp ?? null;
  const lastTime = candles[candles.length - 1]?.timestamp ?? null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !candles.length) return;
    const dark = document.documentElement.classList.contains("dark");
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 260,
      layout: {
        background: { color: "transparent" },
        textColor: dark ? "#9ca3af" : "#6b7280",
      },
      grid: {
        vertLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
        horzLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: "rgba(100,100,100,0.15)" },
      localization: {
        locale: "sv-SE",
        timeFormatter: (time: Time) => typeof time === "number"
          ? new Date(time * 1000).toLocaleTimeString("sv-SE", {
              timeZone: timezone, hour: "2-digit", minute: "2-digit",
            })
          : "",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      priceLineVisible: false,
    });
    series.setData(candles.map((candle) => ({
      time: Math.floor(Date.parse(candle.timestamp) / 1000) as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1);
    volume.setData(candles.flatMap((candle) => candle.volume == null ? [] : [{
      time: Math.floor(Date.parse(candle.timestamp) / 1000) as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? "rgba(22,163,74,0.45)" : "rgba(220,38,38,0.45)",
    }]));

    chart.timeScale().fitContent();
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setHeight(190);
      panes[1].setHeight(65);
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, timezone]);

  return (
    <figure className="min-w-0 overflow-hidden rounded-md border border-border/70 bg-card p-2" data-testid="earnings-intraday-chart">
      <div ref={containerRef} className="w-full" aria-label="Minutbaserat OHLC- och volymdiagram" />
      <figcaption className="mt-2 space-y-1 text-[10px] text-muted-foreground">
        <p>Tidsstämplar: {formatTimestamp(firstTime, timezone)} – {formatTimestamp(lastTime, timezone)} · {timezone}</p>
        <p>{source} · minutdata as-of {formatTimestamp(asOf, timezone)} · hämtad {formatTimestamp(fetchedAt, timezone)}</p>
      </figcaption>
    </figure>
  );
}
