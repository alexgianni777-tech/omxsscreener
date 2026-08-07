import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  ArrowUpRight, ArrowDownRight, Target, Activity, CheckCircle2,
  Clock, Zap, TrendingUp, TrendingDown, BarChart2, Sigma, Trophy,
} from "lucide-react";
import { formatNumber, formatPercent } from "../lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, TooltipProps,
} from "recharts";
import { useTop3Analytics, type Top3Session } from "../lib/useTop3Analytics";

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
        Failed to load dashboard summary.
      </div>
    );
  }

  const winRateColor =
    summary.overallWinRate
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Command Center</h2>
          <p className="text-muted-foreground mt-1">
            Overview of screener performance and candidates.
          </p>
        </div>
        <Link
          href="/import"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 shadow-sm"
          data-testid="btn-quick-import"
        >
          <Zap className="mr-2 h-4 w-4" />
          Quick Import
        </Link>
      </header>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Sessions"
          value={summary.totalSessions.toString()}
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Total Candidates"
          value={summary.totalCandidates.toString()}
          icon={<Target className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Resolved Trades"
          value={summary.resolvedTrades.toString()}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          subtitle={`${summary.wins}W – ${summary.losses}L`}
        />
        <StatCard
          title="Overall Win Rate"
          value={
            summary.overallWinRate ? formatPercent(summary.overallWinRate) : "–"
          }
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          valueClass={winRateColor}
        />
      </div>

      {/* P&L / R-multiple stats */}
      <div>
        <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">
          Edge-statistik (R-multiplar)
        </h3>
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
              Logga utfall med exit-pris för att se R-kurvan.
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

      {/* Top 3 Strategy */}
      <Top3Section />

      {/* Category Breakdown */}
      <div>
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
                  {cat.winRate ? formatPercent(cat.winRate) : "–"}
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
    </div>
  );
}

// Custom dot — colour by outcome, skip the origin point
function CurveDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.outcome) return null; // origin point
  const color =
    payload.outcome === "WIN"
      ? "hsl(var(--success, 142 71% 45%))"
      : "hsl(var(--destructive))";
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
}

// Custom tooltip
function EquityCurveTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d?.outcome) return null; // origin point

  const isWin = d.outcome === "WIN";
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs space-y-1 min-w-[160px]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-bold font-mono">{d.ticker}</span>
        <span
          className={`font-mono font-bold ${isWin ? "text-success" : "text-destructive"}`}
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

// ─── Top 3 Strategy ───────────────────────────────────────────────────────────

function Top3Section() {
  const { data, isLoading } = useTop3Analytics();

  const seSessions = data?.sessions.filter((s) => s.source !== "edgeai") ?? [];
  const usSessions = data?.sessions.filter((s) => s.source === "edgeai") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Trophy className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Top 3 picks — hypotetisk avkastning</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Top3MarketCard label="🇸🇪 Sverige (OMXS30)" sessions={seSessions} isLoading={isLoading} accentColor="hsl(var(--primary))" />
        <Top3MarketCard label="🇺🇸 USA" sessions={usSessions} isLoading={isLoading} accentColor="hsl(var(--success, 142 71% 45%))" />
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

function computeMarketStats(sessions: Top3Session[]) {
  let wins = 0, losses = 0, totalR = 0;
  for (const s of sessions) {
    for (const p of s.picks) {
      if (p.outcome === "WIN") { wins++; totalR += (p.r ?? 0); }
      else if (p.outcome === "LOSS") { losses++; totalR += (p.r ?? 0); }
    }
  }
  const total = wins + losses;
  return {
    wins, losses, total,
    winRate: total > 0 ? wins / total : null,
    totalR,
    avgR: total > 0 ? totalR / total : null,
    completedSessions: sessions.filter((s) => s.sessionR !== null).length,
    totalSessions: sessions.length,
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
  const chartData = computeMarketChartData(sessions);
  const hasData = chartData.length > 1;
  const stats = computeMarketStats(sessions);
  const finalR = hasData ? chartData[chartData.length - 1].cumulativeR : null;

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

      {/* Stat pills */}
      {stats.total > 0 && (
        <div className="flex flex-wrap gap-2">
          <Pill label="Trades" value={`${stats.wins}V / ${stats.losses}F`} />
          <Pill
            label="Hitrate"
            value={stats.winRate != null ? formatPercent(stats.winRate) : "–"}
            color={stats.winRate != null ? (stats.winRate >= 0.5 ? "success" : "destructive") : ""}
          />
          <Pill
            label="Snitt-R"
            value={stats.avgR != null ? `${stats.avgR >= 0 ? "+" : ""}${formatNumber(stats.avgR, 2)}R` : "–"}
            color={stats.avgR != null ? (stats.avgR > 0 ? "success" : "destructive") : ""}
          />
          <Pill label="Sessioner" value={`${stats.completedSessions}/${stats.totalSessions}`} />
        </div>
      )}

      {/* Chart or empty state */}
      {isLoading ? (
        <div className="h-40 bg-muted rounded animate-pulse" />
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <Trophy className="h-6 w-6 opacity-30" />
          <p className="text-xs">Logga utfall för att se kurvan.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}R`} width={36} />
            <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.25} />
            <Tooltip content={<Top3Tooltip sessions={sessions} />} />
            <Line type="linear" dataKey="cumulativeR" strokeWidth={2} stroke={accentColor} dot={{ r: 3, fill: accentColor }} activeDot={{ r: 5 }} isAnimationActive />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Per-session picks table */}
      {sessions.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          {sessions.map((s) => (
            <div key={s.date} className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground w-12 shrink-0 pt-0.5">{s.date.slice(5)}</span>
              <div className="flex gap-1 flex-1 flex-wrap">
                {s.picks.map((p) => (
                  <span
                    key={p.ticker}
                    className={`px-1.5 py-0.5 rounded font-mono font-medium ${
                      p.outcome === "WIN"
                        ? "bg-success/15 text-success"
                        : p.outcome === "LOSS"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.ticker.replace(/\.ST$/i, "")}
                    {p.r != null ? ` ${p.r >= 0 ? "+" : ""}${formatNumber(p.r, 1)}R` : ""}
                  </span>
                ))}
              </div>
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
        <div key={p.ticker} className="flex justify-between gap-4">
          <span className="font-mono">{p.ticker}</span>
          <span
            className={
              p.outcome === "WIN"
                ? "text-success font-mono"
                : p.outcome === "LOSS"
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
