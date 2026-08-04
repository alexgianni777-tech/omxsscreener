import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowUpRight, ArrowDownRight, Target, Activity, CheckCircle2, AlertCircle, Clock, Zap } from "lucide-react";
import { formatNumber, formatPercent } from "../lib/utils";

export function Dashboard() {
  const { data: summary, isLoading, isError } = useGetDashboardSummary();

  if (isLoading) {
    return <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-lg"></div>)}
      </div>
    </div>;
  }

  if (isError || !summary) {
    return <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
      Failed to load dashboard summary.
    </div>;
  }

  const winRateColor = summary.overallWinRate 
    ? summary.overallWinRate >= 0.5 ? "text-success" : "text-destructive" 
    : "text-muted-foreground";

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Command Center</h2>
          <p className="text-muted-foreground mt-1">Overview of screener performance and candidates.</p>
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
          subtitle={`${summary.wins}W - ${summary.losses}L`}
        />
        <StatCard 
          title="Overall Win Rate" 
          value={summary.overallWinRate ? formatPercent(summary.overallWinRate) : "-"} 
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />} 
          valueClass={winRateColor}
        />
      </div>

      {/* Category Breakdown */}
      <div>
        <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Category Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.byCategory.map(cat => (
            <div key={cat.category} className="bg-card border border-border rounded-lg p-5 shadow-sm flex flex-col justify-between hover-elevate transition-all">
              <div className="flex justify-between items-center mb-4">
                <span className="font-bold text-sm tracking-wider text-muted-foreground">{cat.category}</span>
                <span className="text-xl font-bold font-mono">{cat.winRate ? formatPercent(cat.winRate) : "-"}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-sm font-mono bg-muted/50 rounded-md p-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1 uppercase">Total</div>
                  <div>{cat.total}</div>
                </div>
                <div>
                  <div className="text-xs text-success mb-1 uppercase">Wins</div>
                  <div className="text-success">{cat.wins}</div>
                </div>
                <div>
                  <div className="text-xs text-destructive mb-1 uppercase">Losses</div>
                  <div className="text-destructive">{cat.losses}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1 uppercase">Pend</div>
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

function StatCard({ title, value, icon, subtitle, valueClass = "" }: { title: string, value: string, icon: React.ReactNode, subtitle?: string, valueClass?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="tracking-tight text-sm font-medium text-muted-foreground">{title}</h3>
        {icon}
      </div>
      <div>
        <div className={`text-2xl font-bold font-mono ${valueClass}`}>{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
