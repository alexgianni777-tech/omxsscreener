import { GroundZero } from "../components/GroundZero";
import { SavedTop3 } from "../components/SavedTop3";
import { ManualCatalysts } from "../components/ManualCatalysts";
import { useGetDashboardSummary, useListSessions } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  ArrowUpRight, ArrowDownRight, Target, Activity, CheckCircle2,
  Clock, Zap, TrendingUp, TrendingDown, BarChart2, Sigma, Trophy,
  AlertTriangle, CalendarDays, Star,
} from "lucide-react";
import { formatNumber, formatPercent } from "../lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, TooltipProps,
  ComposedChart, Bar, Cell,
} from "recharts";
import { useTop3Analytics, type Top3Session } from "../lib/useTop3Analytics";
import { top3SessionsForSource } from "../lib/top3SourceViews";
import { useMarketIntel, type MarketIntelData } from "../lib/useMarketIntel";
import { useState, useMemo } from "react";
import { DashboardLiveTop3 } from "../components/DashboardLiveTop3";
import { TradeJournal } from "../components/TradeJournal";

export function Dashboard() {
  const { data: summary, isLoading, isError } = useGetDashboardSummary();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-muted rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
        Statistiken kunde inte hämtas. Ladda om sidan för att försöka igen.
      </div>
    );
  }

  const winRateColor =
    summary.overallWinRate != null
      ? summary.overallWinRate >= 0.5
        ? "text-success"
        : "text-destructive"
      : "text-muted-foreground";

  const evColor =
    summary.expectedValue == null
      ? "text-muted-foreground"
      : summary.expectedValue > 0
      ? "text-success"
      : "text-destructive";

  const hasEquityCurve = summary.equityCurve.length > 0;

  // Prepend origin point so the chart starts at 0
  const chartData = hasEquityCurve
    ? [{ tradeIndex: 0, cumulativeR: 0, label: "Start" }, ...summary.equityCurve]
    : [];

  const finalR = hasEquityCurve
    ? summary.equityCurve[summary.equityCurve.length - 1].cumulativeR
    : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Historiska utfall</h2>
          <p className="text-muted-foreground mt-1">
            Avslutade signaler och statistik. Dagens rekommendationer visas separat under Idag.
          </p>
        </div>
        <Link
          href="/import"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 shadow-sm"
          data-testid="btn-quick-import"
        >
          <Zap className="mr-2 h-4 w-4" />
          Snabbimport
        </Link>
      </header>

      <MarketIntelSection />
      <details className="rounded-xl bg-card ring-1 ring-border/60" data-testid="details-current-selection">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Urval och sessioner
          <span className="ml-2 font-normal text-xs text-muted-foreground">sparat officiellt urval, aktuella versioner och sessionens kandidater</span></summary>
        <div className="border-t border-border/50 p-2 sm:p-3 space-y-4">
      <SavedTop3 />
      <TodaySessionPanel />
      <DashboardLiveTop3 />
        </div>
      </details>
      <details className="rounded-xl bg-card ring-1 ring-border/60" data-testid="details-manual-catalysts">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Manuella katalysatorer</summary>
        <div className="border-t border-border/50 p-2 sm:p-3"><ManualCatalysts /></div>
      </details>
      <details className="rounded-xl bg-card ring-1 ring-border/60" data-testid="details-groundzero">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">GroundZero</summary>
        <div className="border-t border-border/50 p-2 sm:p-3"><GroundZero /></div>
      </details>
      <details open className="rounded-xl bg-card ring-1 ring-border/60" data-testid="details-historical-stats">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Historiska utfall och signalanalys
          <span className="ml-2 font-normal text-xs text-muted-foreground">avslutade signaler, inte aktuella rekommendationer</span></summary>
        <div className="border-t border-border/50 p-3 sm:p-4 space-y-8">

      {/* Weekly Summary */}
      <WeekSummarySection equityCurve={summary.equityCurve} />


      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Sessioner totalt"
          value={summary.totalSessions.toString()}
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Kandidater totalt"
          value={summary.totalCandidates.toString()}
          icon={<Target className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Utfall med beräknat R"
          value={summary.resolvedTrades.toString()}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          subtitle={`${summary.wins}V – ${summary.losses}F – ${summary.resolvedTrades - summary.wins - summary.losses} 0R`}
        />
        <StatCard
          title="Träffsäkerhet totalt"
          value={
            summary.overallWinRate != null ? formatPercent(summary.overallWinRate) : "–"
          }
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          valueClass={winRateColor}
        />
      </div>

      {/* P&L / R-multiple stats */}
      <div>
          <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">
          Edge-statistik — alla kandidater (R-multiplar)
        </h3>
        <p className="text-xs text-muted-foreground -mt-2 mb-4">
          Endast utfall med beräknat R ingår. Väntande förslag saknas i snittet, så siffrorna är preliminära.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Snitt-R vinster"
            value={
              summary.avgRWin != null
                ? `+${formatNumber(summary.avgRWin, 2)}R`
                : "–"
            }
            icon={<TrendingUp className="h-4 w-4 text-success" />}
            valueClass="text-success"
          />
          <StatCard
            title="Snitt-R förluster"
            value={
              summary.avgRLoss != null
                ? `${formatNumber(summary.avgRLoss, 2)}R`
                : "–"
            }
            icon={<TrendingDown className="h-4 w-4 text-destructive" />}
            valueClass="text-destructive"
          />
          <StatCard
            title="Payoff-kvot"
            value={
              summary.payoffRatio != null
                ? `${formatNumber(summary.payoffRatio, 2)}:1`
                : "–"
            }
            icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            title="Förväntningsvärde / trade"
            value={
              summary.expectedValue != null
                ? `${summary.expectedValue >= 0 ? "+" : ""}${formatNumber(summary.expectedValue, 2)}R`
                : "–"
            }
            icon={<Sigma className="h-4 w-4 text-muted-foreground" />}
            valueClass={evColor}
            subtitle={summary.equityCurve.length < 20 ? `${summary.equityCurve.length}/20 trades` : undefined}
          />
        </div>
      </div>

      {/* Equity Curve */}
      <div>
        <div className="flex items-center justify-between mb-4 border-b border-border pb-2">
          <h3 className="text-lg font-semibold">Kumulativ R-kurva</h3>
          {finalR != null && (
            <span
              className={`text-sm font-mono font-bold ${
                finalR >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {finalR >= 0 ? "+" : ""}
              {formatNumber(finalR, 2)}R totalt
            </span>
          )}
        </div>

        {!hasEquityCurve ? (
          <div className="flex flex-col items-center justify-center h-48 bg-card border border-border rounded-lg text-muted-foreground gap-2">
            <BarChart2 className="h-8 w-8 opacity-30" />
            <p className="text-sm">
              Logga utfall med beräknat R för att se R-kurvan.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="tradeIndex"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: "Trade #",
                    position: "insideBottomRight",
                    offset: -4,
                    fontSize: 11,
                    fill: "currentColor",
                    opacity: 0.5,
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}R`}
                  width={40}
                />
                <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.25} />
                <Tooltip content={<EquityCurveTooltip />} />
                <Line
                  type="linear"
                  dataKey="cumulativeR"
                  dot={(props) => <CurveDot {...props} />}
                  activeDot={{ r: 5 }}
                  strokeWidth={2}
                  stroke="hsl(var(--primary))"
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Session R Chart */}
      <SessionRCurveSection equityCurve={summary.equityCurve} />

      {/* Rolling 20-trade expectancy */}
      <RollingExpectancySection equityCurve={summary.equityCurve} />

      {/* Top 3 Strategy */}
      <Top3Section />
        </div>
      </details>
      <details className="rounded-xl bg-card ring-1 ring-border/60" data-testid="details-trade-journal">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Exekveringsjournal (avancerat)</summary>
        <div className="border-t border-border/50 p-2 sm:p-3"><TradeJournal /></div>
      </details>

      {/* Category Breakdown */}
      <details className="rounded-xl bg-card ring-1 ring-border/60 p-3 sm:p-4" data-testid="details-category-stats">
        <summary className="cursor-pointer text-sm font-semibold">Kategori-prestanda (historik)</summary>
      <div className="mt-4">
        <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">
          Kategori-prestanda
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.byCategory.map((cat) => (
            <div
              key={cat.category}
              className="bg-card border border-border rounded-lg p-5 shadow-sm flex flex-col justify-between hover-elevate transition-all"
            >
              <div className="flex justify-between items-center mb-4">
                <span className="font-bold text-sm tracking-wider text-muted-foreground">
                  {cat.category}
                </span>
                <span className="text-xl font-bold font-mono">
                  {cat.winRate != null ? formatPercent(cat.winRate) : "–"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-sm font-mono bg-muted/50 rounded-md p-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1 uppercase">
                    Total
                  </div>
                  <div>{cat.total}</div>
                </div>
                <div>
                  <div className="text-xs text-success mb-1 uppercase">Vinst</div>
                  <div className="text-success">{cat.wins}</div>
                </div>
                <div>
                  <div className="text-xs text-destructive mb-1 uppercase">
                    Förlust
                  </div>
                  <div className="text-destructive">{cat.losses}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1 uppercase">
                    Pend
                  </div>
                  <div>{cat.pending}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      </details>
    </div>
  );
}

// Custom dot — colour by outcome, skip the origin point
function CurveDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.outcome) return null; // origin point
  const color =
    payload.r > 0
      ? "hsl(var(--success, 142 71% 45%))"
      : payload.r < 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))";
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
}

// Custom tooltip
function EquityCurveTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d?.outcome) return null; // origin point

  const isWin = d.r > 0;
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs space-y-1 min-w-[160px]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-bold font-mono">
          {d.ticker}{d.outcome === "TIME_EXIT" ? " · Tidsavslut" : ""}
        </span>
        <span
          className={`font-mono font-bold ${isWin ? "text-success" : d.r < 0 ? "text-destructive" : "text-muted-foreground"}`}
        >
          {d.r >= 0 ? "+" : ""}
          {Number(d.r).toFixed(2)}R
        </span>
      </div>
      <div className="text-muted-foreground">{d.date}</div>
      <div className="border-t border-border pt-1 flex justify-between">
        <span className="text-muted-foreground">Kumulativt</span>
        <span className="font-mono font-semibold">
          {d.cumulativeR >= 0 ? "+" : ""}
          {Number(d.cumulativeR).toFixed(2)}R
        </span>
      </div>
    </div>
  );
}

function TodaySessionPanel() {
  const { data: sessions, isLoading } = useListSessions();
  const { data: top3 } = useTop3Analytics();

  // Use sv-SE locale so we get "YYYY-MM-DD" in the Swedish timezone
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const latest = sessions?.[0]; // list is sorted DESC by date
  const isToday = latest?.date === todayStr;

  // Find top-3 picks for the latest session from the already-loaded analytics data
  const top3Session = top3?.sessions.find((s) => s.sessionId === latest?.id);
  const top3Count = top3Session?.picks.length ?? 0;

  const trendLabel = latest?.marketWeather.trendLabel ?? "";
  const trendUp = trendLabel.includes("BULL");
  const trendDown = trendLabel.includes("BEAR");
  const TrendIcon = trendUp ? TrendingUp : trendDown ? TrendingDown : BarChart2;
  const trendColor = trendUp
    ? "text-success"
    : trendDown
    ? "text-destructive"
    : "text-muted-foreground";

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="h-20 bg-muted rounded-lg animate-pulse" />;
  }

  // ── No session yet today ──────────────────────────────────────────────────
  if (!isToday) {
    return (
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-muted">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Dagens session</p>
            <p className="text-sm font-semibold mt-0.5">
              Ingen signal ännu idag — Telegram-import inväntas
            </p>
          </div>
        </div>
        {latest && (
          <Link
            href={`/sessions/${latest.id}`}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Senaste: {latest.date}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    );
  }

  // ── Today's session exists ────────────────────────────────────────────────
  const { marketWeather, totalCandidates, id } = latest;

  return (
    <div className="bg-card border border-primary/30 rounded-lg p-5 shadow-sm ring-1 ring-primary/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: date + market snapshot */}
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-full bg-primary/10 shrink-0">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Dagens session</p>
              <p className="text-sm font-bold mt-0.5">{latest.date}</p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {/* OMXS30 value */}
              <span className="flex items-center gap-1 bg-muted/60 rounded-md px-2.5 py-1 font-mono font-semibold">
                Historisk sessionsreferens OMXS30 {formatNumber(marketWeather.omxsValue, 1)} · ej live
              </span>
              {/* Trend */}
              <span className={`flex items-center gap-1 bg-muted/60 rounded-md px-2.5 py-1 font-medium ${trendColor}`}>
                <TrendIcon className="h-3.5 w-3.5" />
                {trendLabel}
              </span>
              {/* Candidates */}
              <span className="flex items-center gap-1 bg-muted/60 rounded-md px-2.5 py-1 text-muted-foreground">
                <Target className="h-3.5 w-3.5" />
                {totalCandidates} kandidater
              </span>
            </div>
          </div>
        </div>

        {/* Right: top3 picks preview + open button */}
        <div className="flex items-center gap-3 sm:flex-col sm:items-end">
          {/* Ticker chips come only from the official snapshot. */}
          {top3Session?.picks && top3Session.picks.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {top3Session.picks.map((p) => (
                <span
                  key={`${p.direction}:${p.ticker}:${p.signalSource ?? "unknown"}`}
                  className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border ${
                    p.direction === "SHORT"
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : "bg-success/10 text-success border-success/20"
                  } ${p.outcome === "LOSS" ? "opacity-40 line-through" : p.outcome === "WIN" ? "opacity-70" : ""}`}
                  title={`${p.direction} · ${p.signalSource ?? "okänd källa"} · ${p.outcome ?? "PENDING"}`}
                >
                  {p.ticker.replace(/\.ST$/i, "")}
                  {p.signalSource === "edgeai" ? " · E" : p.signalSource === "telegram" ? " · T" : ""}
                  {p.outcome === "WIN" ? " · V" : p.outcome === "LOSS" ? " · F" : ""}
                </span>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              {[0, 1, 2].map((i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${
                    i < top3Count
                      ? "text-amber-400 fill-amber-400"
                      : "text-muted-foreground/30"
                  }`}
                />
              ))}
              <span className="ml-1 text-muted-foreground font-medium">
                {top3Session?.selectionStatus === "UNAVAILABLE"
                  ? "Officiellt urval saknas"
                  : `${top3Count} officiella picks`}
              </span>
            </div>
          )}
          {/* Open session link */}
          <Link
            href={`/sessions/${id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 hover:bg-primary/90 transition-colors shadow-sm shrink-0"
          >
            Öppna session
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Week Summary ─────────────────────────────────────────────────────────────

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function WeekSummarySection({ equityCurve }: { equityCurve: EquityPoint[] }) {
  const { weekNum, mondayStr, wins, losses, winRate, totalR, bestPick, trades } = useMemo(() => {
    const now = new Date();
    const day = now.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
    const mondayStr = monday.toISOString().slice(0, 10);
    const weekNum = getISOWeekNumber(now);

    const thisWeek = equityCurve.filter((t) => t.date >= mondayStr);
    let wins = 0, losses = 0, totalR = 0;
    let bestPick: { ticker: string; r: number } | null = null;
    for (const t of thisWeek) {
      if (t.r > 0) wins++;
      else if (t.r < 0) losses++;
      totalR += t.r;
      if (!bestPick || t.r > bestPick.r) bestPick = { ticker: t.ticker, r: t.r };
    }
    return {
      weekNum,
      mondayStr,
      trades: thisWeek.length,
      wins,
      losses,
      winRate: thisWeek.length > 0 ? wins / thisWeek.length : null,
      totalR: Math.round(totalR * 100) / 100,
      bestPick,
    };
  }, [equityCurve]);

  const rColor = totalR > 0 ? "text-success" : totalR < 0 ? "text-destructive" : "text-muted-foreground";
  const wrColor = winRate != null ? (winRate >= 0.5 ? "text-success" : "text-destructive") : "text-muted-foreground";

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-base">Sammanfattning vecka {weekNum}</h3>
        <span className="text-xs text-muted-foreground">{mondayStr} →</span>
      </div>
      {trades === 0 ? (
        <p className="text-sm text-muted-foreground">Inga utfall med beräknat R denna vecka.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <div className={`text-2xl font-bold font-mono ${rColor}`}>
              {totalR >= 0 ? "+" : ""}{formatNumber(totalR, 2)}R
            </div>
            <div className="text-xs text-muted-foreground mt-1">Total R</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold font-mono ${wrColor}`}>
              {winRate != null ? formatPercent(winRate) : "–"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Win rate</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold font-mono">
              <span className="text-success">{wins}V</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-destructive">{losses}F</span>
              {trades > wins + losses && <span className="text-muted-foreground"> / {trades - wins - losses} 0R</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Trades</div>
          </div>
          <div className="text-center">
            {bestPick ? (
              <>
                <div className="text-2xl font-bold font-mono text-success">
                  {bestPick.ticker.replace(/\.ST$/i, "")}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Bästa pick (+{formatNumber(bestPick.r, 2)}R)
                </div>
              </>
            ) : (
              <div className="text-2xl font-bold font-mono text-muted-foreground">–</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Market Intel ─────────────────────────────────────────────────────────────

function fgColor(score: number): string {
  if (score <= 25) return "#ef4444"; // extreme fear
  if (score <= 45) return "#f97316"; // fear
  if (score <= 55) return "#eab308"; // neutral
  if (score <= 75) return "#84cc16"; // greed
  return "#22c55e";                  // extreme greed
}

function fgLabel(rating: string): string {
  const map: Record<string, string> = {
    "Extreme Fear": "Extrem Rädsla",
    "Fear": "Rädsla",
    "Neutral": "Neutralt",
    "Greed": "Girighet",
    "Extreme Greed": "Extrem Girighet",
  };
  return map[rating] ?? rating;
}

export function MarketIntelSection() {
  const { data, isLoading } = useMarketIntel();

  const peRows: { label: string; key: keyof MarketIntelData["pe"]; avg: number }[] = [
    { label: "S&P 500 (SPY)", key: "sp500", avg: 17 },
    { label: "Nasdaq 100 (QQQ)", key: "nasdaq", avg: 25 },
    { label: "OMXS30", key: "omxs30", avg: 15 },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-3 sm:p-4" data-testid="market-weather">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Marknadsläge · separat omvärldsdata</h3>
        <p className="text-xs font-mono" data-testid="text-market-weather-summary">
          {isLoading ? <span className="text-muted-foreground">Läser marknadsläge…</span>
            : !data?.fearGreed ? <span className="text-muted-foreground">Fear &amp; Greed saknas</span>
            : <>F&amp;G <strong style={{ color: fgColor(data.fearGreed.score) }}>{data.fearGreed.score}</strong> {fgLabel(data.fearGreed.rating)}</>}
          {data && peRows.map(({ label, key }) => data.pe[key].trailing != null
            ? <span key={key} className="ml-2 text-muted-foreground">{label.split(" (")[0]} P/E {Math.round((data.pe[key].trailing as number) * 10) / 10}</span> : null)}
        </p>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">Visa Fear &amp; Greed och P/E-detaljer</summary>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fear & Greed */}
        <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground mb-3">CNN Fear &amp; Greed Index</div>
          {isLoading ? (
            <div className="h-20 bg-muted animate-pulse rounded" />
          ) : !data?.fearGreed ? (
            <p className="text-sm text-muted-foreground">Kunde inte hämta data.</p>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-3">
                <div
                  className="text-4xl font-black font-mono"
                  style={{ color: fgColor(data.fearGreed.score) }}
                >
                  {data.fearGreed.score}
                </div>
                <div>
                  <div className="font-semibold" style={{ color: fgColor(data.fearGreed.score) }}>
                    {fgLabel(data.fearGreed.rating)}
                  </div>
                  <div className="text-xs text-muted-foreground">av 100</div>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden mb-3">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${data.fearGreed.score}%`,
                    backgroundColor: fgColor(data.fearGreed.score),
                  }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="text-muted-foreground">Igår</div>
                  <div className="font-mono font-semibold">{data.fearGreed.previousClose}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">1 vecka</div>
                  <div className="font-mono font-semibold">{data.fearGreed.previousWeek}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">1 månad</div>
                  <div className="font-mono font-semibold">{data.fearGreed.previousMonth}</div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* P/E Ratios */}
        <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground mb-3">P/E-tal (aktuellt vs historiskt snitt)</div>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">Kunde inte hämta data.</p>
          ) : (
            <div className="space-y-3">
              {peRows.map(({ label, key, avg }) => {
                const pe = data.pe[key];
                const trailing = pe.trailing != null ? Math.round(pe.trailing * 10) / 10 : null;
                const forward = pe.forward != null ? Math.round(pe.forward * 10) / 10 : null;
                const vsAvg = trailing != null ? trailing - avg : null;
                const color = vsAvg == null ? "" : vsAvg > 5 ? "text-destructive" : vsAvg < -2 ? "text-success" : "text-muted-foreground";
                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{label}</span>
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <div className={`font-mono font-bold text-sm ${color}`}>
                          {trailing ?? "–"}
                        </div>
                        <div className="text-xs text-muted-foreground">trailing</div>
                      </div>
                      <div>
                        <div className="font-mono text-sm text-muted-foreground">
                          {forward ?? "–"}
                        </div>
                        <div className="text-xs text-muted-foreground">forward</div>
                      </div>
                      <div>
                        <div className="font-mono text-xs text-muted-foreground">
                          snitt ~{avg}
                        </div>
                        {vsAvg != null && (
                          <div className={`text-xs font-semibold ${color}`}>
                            {vsAvg > 0 ? "+" : ""}{vsAvg.toFixed(1)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </details>
    </section>
  );
}

// ─── Session R Curve ──────────────────────────────────────────────────────────

interface EquityPoint {
  date: string;
  r: number;
  ticker: string;
  outcome: "WIN" | "LOSS" | "TIME_EXIT";
  tradeIndex: number;
  cumulativeR: number;
}

function buildSessionData(equityCurve: EquityPoint[]) {
  const byDate: Record<string, number> = {};
  const dateOrder: string[] = [];
  for (const pt of equityCurve) {
    if (!(pt.date in byDate)) {
      byDate[pt.date] = 0;
      dateOrder.push(pt.date);
    }
    byDate[pt.date] = Math.round((byDate[pt.date] + pt.r) * 1000) / 1000;
  }
  let cum = 0;
  return dateOrder.map((date) => {
    cum = Math.round((cum + byDate[date]) * 1000) / 1000;
    return {
      date: date.slice(5),
      fullDate: date,
      sessionR: Math.round(byDate[date] * 1000) / 1000,
      cumulativeR: cum,
    };
  });
}

// ─── Rolling 20-trade expectancy ──────────────────────────────────────────────

function RollingExpectancySection({ equityCurve }: { equityCurve: EquityPoint[] }) {
  const WINDOW = 20;
  const recent = equityCurve.slice(-WINDOW);
  const total  = recent.length;

  if (total < 5) return null; // too few data points to show anything meaningful

  const winTrades = recent.filter(pt => pt.r > 0);
  const lossTrades = recent.filter(pt => pt.r < 0);
  const wins = winTrades.length;
  const losses = lossTrades.length;
  const winRate = total > 0 ? wins / total : 0;

  const avgWinR = wins > 0 ? winTrades.reduce((s, pt) => s + pt.r, 0) / wins : 0;
  const avgLossR = losses > 0 ? Math.abs(lossTrades.reduce((s, pt) => s + pt.r, 0) / losses) : 0;
  const expectancy = recent.reduce((sum, pt) => sum + pt.r, 0) / total;

  const isPositive = expectancy > 0;
  const label = total < WINDOW ? `Senaste ${total} trades` : `Senaste ${WINDOW} trades`;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border pb-2 mb-4">
        <Sigma className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Rullande expectancy</h3>
        <span className="text-xs text-muted-foreground ml-1">({label})</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-4 text-center shadow-sm">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win rate</div>
          <div className={`text-2xl font-bold ${winRate >= 0.5 ? "text-success" : "text-destructive"}`}>
            {(winRate * 100).toFixed(0)}%
          </div>
            <div className="text-[10px] text-muted-foreground mt-1">{wins}V / {losses}F / {total - wins - losses} 0R</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center shadow-sm">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Avg vinst</div>
          <div className="text-2xl font-bold text-success">+{formatNumber(avgWinR, 2)}R</div>
          <div className="text-[10px] text-muted-foreground mt-1">per vinnande trade</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center shadow-sm">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Avg förlust</div>
          <div className="text-2xl font-bold text-destructive">-{formatNumber(avgLossR, 2)}R</div>
          <div className="text-[10px] text-muted-foreground mt-1">per förlorande trade</div>
        </div>
        <div className={`border rounded-lg p-4 text-center shadow-sm ${isPositive ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"}`}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Expectancy</div>
          <div className={`text-2xl font-bold ${isPositive ? "text-success" : "text-destructive"}`}>
            {isPositive ? "+" : ""}{formatNumber(expectancy, 2)}R
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">per trade i snitt</div>
        </div>
      </div>
      {!isPositive && total >= 10 && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          Negativ expectancy — systemet tappar pengar per trade i snitt. Justera strategi eller vänta på fler observationer.
        </p>
      )}
    </div>
  );
}

function SessionRCurveSection({ equityCurve }: { equityCurve: EquityPoint[] }) {
  const sessionData = buildSessionData(equityCurve);
  const hasData = sessionData.length > 0;
  const finalR = hasData ? sessionData[sessionData.length - 1].cumulativeR : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 border-b border-border pb-2">
        <h3 className="text-lg font-semibold">R per session</h3>
        {finalR != null && (
          <span className={`text-sm font-mono font-bold ${finalR >= 0 ? "text-success" : "text-destructive"}`}>
            {finalR >= 0 ? "+" : ""}{formatNumber(finalR, 2)}R totalt
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-48 bg-card border border-border rounded-lg text-muted-foreground gap-2">
          <BarChart2 className="h-8 w-8 opacity-30" />
          <p className="text-sm">Logga utfall med exit-pris för att se sessionsresultat.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={sessionData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}R`} width={40} />
              <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.25} />
              <Tooltip content={<SessionTooltip />} />
              <Bar dataKey="sessionR" radius={[3, 3, 0, 0]} maxBarSize={40}>
                {sessionData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.sessionR >= 0
                        ? "hsl(142 71% 45%)"
                        : "hsl(var(--destructive))"
                    }
                    fillOpacity={0.75}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="cumulativeR"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Staplar = netto-R per dag · Linje = kumulativt
          </p>
        </div>
      )}
    </div>
  );
}

function SessionTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as { fullDate: string; sessionR: number; cumulativeR: number } | undefined;
  if (!d) return null;
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs space-y-1 min-w-[160px]">
      <div className="font-semibold text-muted-foreground">{d.fullDate}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Session</span>
        <span className={`font-mono font-bold ${d.sessionR >= 0 ? "text-success" : "text-destructive"}`}>
          {d.sessionR >= 0 ? "+" : ""}{formatNumber(d.sessionR, 2)}R
        </span>
      </div>
      <div className="flex justify-between gap-4 border-t border-border pt-1">
        <span className="text-muted-foreground">Kumulativt</span>
        <span className="font-mono font-semibold">
          {d.cumulativeR >= 0 ? "+" : ""}{formatNumber(d.cumulativeR, 2)}R
        </span>
      </div>
    </div>
  );
}

// ─── Top 3 Strategy ───────────────────────────────────────────────────────────

function Top3Section() {
  const { data, isLoading } = useTop3Analytics();

  const legacySessions = top3SessionsForSource(data?.sessions ?? [], "telegram");
  const edgeAiSessions = top3SessionsForSource(data?.sessions ?? [], "edgeai");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Trophy className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Top 3 — officiellt signal-time-urval</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        Frysta urval från första signal-time-importen, endast TRADEABLE och högst tre per market/riktning. Äldre sessioner utan sparad snapshot markeras som otillgängliga och ingår inte i resultatet.
        {" "}Detta är historiska signalutfall, inte bekräftad netto-edge från verkliga affärer. Verkliga och simulerade fills följs separat i journalen.
      </p>
      {(data?.sessions.filter((s) => s.selectionStatus === "UNAVAILABLE").length ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Historik utan officiellt urval: {data?.sessions.filter((s) => s.selectionStatus === "UNAVAILABLE").length} sessioner. De räknas inte till någon källas resultat.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Top3MarketCard label="Legacy / Telegram — officiella picks" sessions={legacySessions} isLoading={isLoading} accentColor="hsl(var(--primary))" />
        <Top3MarketCard label="EdgeAI (SE + US) — officiella picks" sessions={edgeAiSessions} isLoading={isLoading} accentColor="hsl(var(--success, 142 71% 45%))" />
      </div>
    </div>
  );
}

function computeMarketChartData(sessions: Top3Session[]) {
  let cum = 0;
  const points: { date: string; cumulativeR: number }[] = [{ date: "Start", cumulativeR: 0 }];
  for (const s of sessions) {
    if (s.sessionR !== null) {
      cum += s.sessionR;
      points.push({ date: s.date.slice(5), cumulativeR: cum });
    }
  }
  return points;
}

function isCountedTop3Pick(pick: Top3Session["picks"][number]): boolean {
  return pick.r != null &&
    (pick.outcome === "WIN" || pick.outcome === "LOSS" || pick.outcome === "TIME_EXIT");
}

function isWinningTop3Pick(pick: Top3Session["picks"][number]): boolean {
  return pick.r != null &&
    (pick.outcome === "WIN" || (pick.outcome === "TIME_EXIT" && pick.r > 0));
}

function isLosingTop3Pick(pick: Top3Session["picks"][number]): boolean {
  return pick.r != null &&
    (pick.outcome === "LOSS" || (pick.outcome === "TIME_EXIT" && pick.r < 0));
}

function computeMarketStats(sessions: Top3Session[]) {
  const available = sessions.filter((s) => s.selectionStatus === "AVAILABLE");
  const matured = available.filter((s) => s.matured);
  const summarize = (picks: Top3Session["picks"]) => {
    let wins = 0, losses = 0, flats = 0, totalR = 0;
    for (const pick of picks) {
      if (!isCountedTop3Pick(pick)) continue;
      totalR += pick.r!;
      if (isWinningTop3Pick(pick)) wins++;
      else if (isLosingTop3Pick(pick)) losses++;
      else flats++;
    }
    const total = wins + losses + flats;
    return {
      wins, losses, flats, total, totalR,
      winRate: total > 0 ? wins / total : null,
      avgR: total > 0 ? totalR / total : null,
    };
  };
  const matureStats = summarize(matured.flatMap((session) => session.picks));
  const resolvedOnly = summarize(available.flatMap((session) => session.picks));
  const selectedTrades = available.reduce((count, session) => count + session.picks.length, 0);
  const resolvedTrades = available.flatMap((session) => session.picks).filter(isCountedTop3Pick).length;
  const pendingTrades = available.flatMap((session) => session.picks)
    .filter((pick) => pick.outcome !== "SKIP" && !isCountedTop3Pick(pick)).length;
  const excludedTrades = available.flatMap((session) => session.picks)
    .filter((pick) => pick.outcome === "SKIP").length;
  return {
    ...matureStats,
    resolvedOnly,
    selectedTrades,
    resolvedTrades,
    pendingTrades,
    excludedTrades,
    resolutionRate: selectedTrades > 0 ? resolvedTrades / selectedTrades : null,
    completedSessions: matured.length,
    totalSessions: available.length,
    unavailableSessions: sessions.filter((s) => s.selectionStatus === "UNAVAILABLE").length,
  };
}

function Top3MarketCard({
  label, sessions, isLoading, accentColor,
}: {
  label: string;
  sessions: Top3Session[];
  isLoading: boolean;
  accentColor: string;
}) {
  const [excludeEarnings, setExcludeEarnings] = useState(false);

  const displaySessions = useMemo(() => {
    if (!excludeEarnings) return sessions;
    return sessions.map((s) => ({
      ...s,
      picks: s.picks.filter((p) => !p.earningsWarning),
    }));
  }, [sessions, excludeEarnings]);

  const chartData = computeMarketChartData(displaySessions.filter((s) => s.matured));
  const hasData = chartData.length > 1;
  const stats = computeMarketStats(displaySessions);
  const finalR = hasData ? chartData[chartData.length - 1].cumulativeR : null;

  const earningsWarningCount = useMemo(
    () => sessions.reduce((n, s) => n + s.picks.filter((p) => p.earningsWarning).length, 0),
    [sessions],
  );

  // #28 — Rule 7 side-by-side comparison (raw vs clean)
  const rawStats = useMemo(() => computeMarketStats(sessions), [sessions]);
  const cleanSessions = useMemo(
    () => sessions.map((s) => ({ ...s, picks: s.picks.filter((p) => !p.earningsWarning) })),
    [sessions],
  );
  const cleanStats = useMemo(() => computeMarketStats(cleanSessions), [cleanSessions]);

  return (
    <div className="bg-card border border-border rounded-lg p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{label}</span>
        {finalR != null && (
          <span className={`font-mono font-bold text-sm ${finalR >= 0 ? "text-success" : "text-destructive"}`}>
            {finalR >= 0 ? "+" : ""}{formatNumber(finalR, 2)}R
          </span>
        )}
      </div>

      {/* Earnings-filter toggle */}
      {earningsWarningCount > 0 && (
        <div className="flex items-center justify-between py-1.5 px-2 bg-amber-500/5 rounded-md border border-amber-500/20">
          <div className="flex items-center gap-1.5 text-xs text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{earningsWarningCount} pick{earningsWarningCount !== 1 ? "s" : ""} med rapportvarning</span>
          </div>
          <button
            onClick={() => setExcludeEarnings((v) => !v)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors font-medium ${
              excludeEarnings
                ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                : "bg-muted border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {excludeEarnings ? "Ren kurva" : "Exkludera"}
          </button>
        </div>
      )}

      {/* Stat pills */}
      {stats.selectedTrades > 0 && (
        <div className="flex flex-wrap gap-2">
          <Pill label="Mogen kohort" value={`${stats.wins}V / ${stats.losses}F / ${stats.flats}0R`} />
          <Pill
            label="Mogen hitrate"
            value={stats.winRate != null ? formatPercent(stats.winRate) : "–"}
            color={stats.winRate != null ? (stats.winRate >= 0.5 ? "success" : "destructive") : ""}
          />
          <Pill
            label="Mogen EV"
            value={stats.avgR != null ? `${stats.avgR >= 0 ? "+" : ""}${formatNumber(stats.avgR, 2)}R` : "–"}
            color={stats.avgR != null ? (stats.avgR > 0 ? "success" : "destructive") : ""}
          />
          <Pill label="Mogna sessioner" value={`${stats.completedSessions}/${stats.totalSessions}`} />
          <Pill label="Täckning" value={`${stats.resolvedTrades}/${stats.selectedTrades} · ${stats.resolutionRate != null ? formatPercent(stats.resolutionRate) : "–"}`} />
          <Pill label="Väntar / SKIP" value={`${stats.pendingTrades} / ${stats.excludedTrades}`} />
          {stats.resolvedOnly.total > 0 && (
            <Pill
              label="Endast lösta (preliminärt)"
              value={`${stats.resolvedOnly.winRate != null ? formatPercent(stats.resolvedOnly.winRate) : "–"} · ${stats.resolvedOnly.avgR != null ? `${stats.resolvedOnly.avgR >= 0 ? "+" : ""}${formatNumber(stats.resolvedOnly.avgR, 2)}R` : "–"}`}
            />
          )}
          {stats.unavailableSessions > 0 && (
            <Pill label="Historik utan snapshot" value={String(stats.unavailableSessions)} />
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Primärt visas bara fullt mogna sessioner. Väntande picks saknar resultat och är exkluderade; den separat märkta endast-lösta statistiken är preliminär. SKIP räknas inte som trade.
      </p>

      {/* #28 Rule 7 comparison — shown when earnings exclusions make a real difference */}
      {earningsWarningCount > 0 && rawStats.total > 0 && (
        <div className="bg-amber-500/5 rounded-md border border-amber-500/20 px-3 py-2.5 space-y-1.5">
          <div className="text-[10px] text-amber-500 font-semibold uppercase tracking-wide">
            Regel 7 påverkan
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground text-[10px] mb-0.5">Utan Regel 7</div>
              <div className="font-mono">{rawStats.winRate != null ? formatPercent(rawStats.winRate) : "–"} hitrate</div>
              <div className={`font-mono font-bold ${rawStats.avgR != null ? (rawStats.avgR > 0 ? "text-success" : "text-destructive") : ""}`}>
                {rawStats.avgR != null ? `${rawStats.avgR >= 0 ? "+" : ""}${formatNumber(rawStats.avgR, 2)}R` : "–"} snitt
              </div>
            </div>
            <div>
              <div className="text-success text-[10px] mb-0.5 font-medium">Med Regel 7 ✓</div>
              <div className="font-mono">{cleanStats.winRate != null ? formatPercent(cleanStats.winRate) : "–"} hitrate</div>
              <div className={`font-mono font-bold ${cleanStats.avgR != null ? (cleanStats.avgR > 0 ? "text-success" : "text-destructive") : ""}`}>
                {cleanStats.avgR != null ? `${cleanStats.avgR >= 0 ? "+" : ""}${formatNumber(cleanStats.avgR, 2)}R` : "–"} snitt
              </div>
            </div>
          </div>
        </div>
      )}

      {/* #56 Direction split — LONG vs SHORT hitrate (shown when there is resolved data) */}
      {(() => {
        const matureSessions = sessions.filter((s) => s.matured);
        const allLong = matureSessions.flatMap((s) => s.longPicks ?? []);
        const allShort = matureSessions.flatMap((s) => s.shortPicks ?? []);
        const longRes = allLong.filter(isCountedTop3Pick);
        const shortRes = allShort.filter(isCountedTop3Pick);
        if (longRes.length === 0 && shortRes.length === 0) return null;
        const longWR = longRes.length > 0 ? longRes.filter(isWinningTop3Pick).length / longRes.length : null;
        const shortWR = shortRes.length > 0 ? shortRes.filter(isWinningTop3Pick).length / shortRes.length : null;
        const avgR = (pool: typeof longRes) => {
          const rs = pool.map((p) => p.r).filter((r): r is number => r != null);
          return rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
        };
        const longAvgR = avgR(longRes);
        const shortAvgR = avgR(shortRes);
        return (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-success/5 border border-success/15 rounded-md p-2">
              <div className="text-[10px] text-success font-semibold mb-0.5">📈 Mogna köp-picks</div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono">{longWR != null ? formatPercent(longWR) : "—"} hitrate</span>
                <span className={`font-mono font-bold ${longAvgR != null ? (longAvgR >= 0 ? "text-success" : "text-destructive") : ""}`}>
                  {longAvgR != null ? `${longAvgR >= 0 ? "+" : ""}${formatNumber(longAvgR, 2)}R` : "—"} snitt
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">{longRes.length}/{allLong.length} avslutade</div>
            </div>
            <div className="bg-destructive/5 border border-destructive/15 rounded-md p-2">
              <div className="text-[10px] text-destructive font-semibold mb-0.5">📉 Mogna sälj-picks</div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono">{shortWR != null ? formatPercent(shortWR) : "—"} hitrate</span>
                <span className={`font-mono font-bold ${shortAvgR != null ? (shortAvgR >= 0 ? "text-success" : "text-destructive") : ""}`}>
                  {shortAvgR != null ? `${shortAvgR >= 0 ? "+" : ""}${formatNumber(shortAvgR, 2)}R` : "—"} snitt
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">{shortRes.length}/{allShort.length} avslutade</div>
            </div>
          </div>
        );
      })()}

      {/* #47 EdgeAI kalibrering — lovad WR vs faktisk WR */}
      {sessions.some((s) => s.edgeWinRate != null) && (() => {
        const withRate = sessions.filter((s) => s.selectionStatus === "AVAILABLE" && s.edgeWinRate != null);
        if (withRate.length === 0) return null;
        const avgPromised = withRate.reduce((a, s) => a + (s.edgeWinRate ?? 0), 0) / withRate.length;
        const allResolved = sessions.filter((s) => s.matured).flatMap((s) => s.picks).filter(isCountedTop3Pick);
        const actualWR = allResolved.length > 0 ? allResolved.filter(isWinningTop3Pick).length / allResolved.length : null;
        return (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-md px-3 py-2 space-y-1.5">
            <div className="text-[10px] text-blue-400 font-semibold uppercase tracking-wide">
              EdgeAI kalibrering
            </div>
            <div className="flex gap-4 text-xs">
              <div>
                <div className="text-muted-foreground text-[10px]">Lovad WR</div>
                <div className="font-mono font-bold">{formatPercent(avgPromised)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px]">Mogen faktisk WR</div>
                <div className={`font-mono font-bold ${actualWR != null ? (actualWR >= avgPromised ? "text-success" : "text-destructive") : ""}`}>
                  {actualWR != null ? formatPercent(actualWR) : "—"}
                </div>
              </div>
              {actualWR == null && (
                <div className="text-muted-foreground text-[10px] self-end italic">Logga utfall för att se jämförelse</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Chart or empty state */}
      {isLoading ? (
        <div className="h-40 bg-muted rounded animate-pulse" />
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <Trophy className="h-6 w-6 opacity-30" />
          <p className="text-xs">Inga mogna sessioner med registrerade utfall ännu.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}R`} width={36} />
            <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.25} />
            <Tooltip content={<Top3Tooltip sessions={displaySessions} />} />
            <Line type="linear" dataKey="cumulativeR" strokeWidth={2} stroke={accentColor} dot={{ r: 3, fill: accentColor }} activeDot={{ r: 5 }} isAnimationActive />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Per-session picks table — always shows raw sessions with warning badges */}
        {sessions.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          {sessions.map((s) => (
            <div key={s.date} className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground w-12 shrink-0 pt-0.5">{s.date.slice(5)}</span>
                {s.selectionStatus === "UNAVAILABLE" ? (
                  <span className="flex-1 text-amber-600">{s.selectionUnavailableReason ?? "Officiellt Top 3-urval saknas."}</span>
                ) : <div className="flex gap-1 flex-1 flex-wrap">
                {s.picks.map((p) => (
                  <span
                     key={`${p.direction}:${p.ticker}:${p.signalSource ?? "unknown"}`}
                     title={`${p.signalSource ?? "okänd källa"}${p.earningsWarning ? " · Rapportvarning — Regel 7 hade exkluderat denna" : ""}`}
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono font-medium ${
                      p.earningsWarning ? "ring-1 ring-amber-500/50" : ""
                    } ${
                      isWinningTop3Pick(p)
                        ? "bg-success/15 text-success"
                        : isLosingTop3Pick(p)
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.earningsWarning && (
                      <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                    )}
                    {p.ticker.replace(/\.ST$/i, "")}
                     {p.signalSource === "edgeai" ? " · E" : p.signalSource === "telegram" ? " · T" : ""}
                    {p.r != null ? ` ${p.r >= 0 ? "+" : ""}${formatNumber(p.r, 1)}R` : ""}
                  </span>
                ))}
                </div>}
              {s.sessionR !== null && (
                <span className={`font-mono font-bold shrink-0 ${s.sessionR >= 0 ? "text-success" : "text-destructive"}`}>
                  {s.sessionR >= 0 ? "+" : ""}{formatNumber(s.sessionR, 1)}R
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  value,
  color = "",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const colorClass =
    color === "success"
      ? "text-success"
      : color === "destructive"
      ? "text-destructive"
      : "text-foreground";
  return (
    <div className="bg-muted/60 rounded-md px-3 py-1.5 text-xs flex gap-2 items-baseline">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-bold ${colorClass}`}>{value}</span>
    </div>
  );
}

function Top3Tooltip({
  active,
  payload,
  sessions,
}: TooltipProps<number, string> & { sessions: Top3Session[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { date: string; cumulativeR: number };
  if (d.date === "Start") return null;

  const fullDate = sessions.find((s) => s.date.slice(5) === d.date)?.date;
  const session = sessions.find((s) => s.date === fullDate);

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs space-y-2 min-w-[180px]">
      <div className="font-semibold text-muted-foreground">{fullDate ?? d.date}</div>
      {session?.picks.map((p) => (
        <div key={`${p.direction}:${p.ticker}:${p.signalSource ?? "unknown"}`} className="flex justify-between gap-4">
          <span className="font-mono flex items-center gap-1">
            {p.earningsWarning && <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />}
            {p.ticker} · {p.signalSource ?? "okänd"}
          </span>
          <span
            className={
              isWinningTop3Pick(p)
                ? "text-success font-mono"
                : isLosingTop3Pick(p)
                ? "text-destructive font-mono"
                : "text-muted-foreground"
            }
          >
            {p.r != null
              ? `${p.r >= 0 ? "+" : ""}${formatNumber(p.r, 2)}R`
              : p.outcome}
          </span>
        </div>
      ))}
      <div className="border-t border-border pt-1 flex justify-between">
        <span className="text-muted-foreground">Kumulativt</span>
        <span className="font-mono font-semibold">
          {d.cumulativeR >= 0 ? "+" : ""}
          {formatNumber(d.cumulativeR, 2)}R
        </span>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon,
  subtitle,
  valueClass = "",
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="tracking-tight text-sm font-medium text-muted-foreground">
          {title}
        </h3>
        {icon}
      </div>
      <div>
        <div className={`text-2xl font-bold font-mono ${valueClass}`}>
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
