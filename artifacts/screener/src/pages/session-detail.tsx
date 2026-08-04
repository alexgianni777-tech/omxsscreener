import { useGetSession, getGetSessionQueryKey, useGetQuotes, Candidate, CandidateOutcomeProperty, useUpdateCandidateOutcome, QuoteResult } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { formatNumber, formatPercent, formatDate } from "../lib/utils";
import { ArrowLeft, TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair, RefreshCw, BarChart2, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";

export function SessionDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { data: session, isLoading, isError } = useGetSession(id, { query: { enabled: !!id, queryKey: getGetSessionQueryKey(id) } });

  const tickers = session?.candidates.map((c) => c.ticker) ?? [];
  const tickersParam = tickers.join(",");
  const { data: quotes } = useGetQuotes(
    { tickers: tickersParam },
    { query: { enabled: tickers.length > 0, refetchInterval: 60_000 } }
  );

  const quoteMap: Record<string, QuoteResult> = {};
  quotes?.forEach((q) => { quoteMap[q.ticker] = q; });

  if (isLoading) {
    return <div className="animate-pulse space-y-8">
      <div className="h-8 w-24 bg-muted rounded"></div>
      <div className="h-32 bg-muted rounded-lg"></div>
      <div className="h-64 bg-muted rounded-lg"></div>
    </div>;
  }

  if (isError || !session) {
    return <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">Failed to load session details.</div>;
  }

  const { marketWeather, candidates } = session;

  const categories = ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] as const;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex items-center gap-4">
        <Link href="/sessions" className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Session: {formatDate(session.date)}</h2>
        </div>
      </div>

      {/* Market Weather Banner */}
      <div className="bg-card border-l-4 border-l-primary border-y border-r border-border rounded-r-lg p-6 shadow-sm">
        <div className="flex flex-col md:flex-row gap-6 md:items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1"><BarChart2 className="w-4 h-4"/> Market Weather</div>
            <div className="text-3xl font-bold font-mono tracking-tight">{formatNumber(marketWeather.omxsValue, 1)}</div>
            <div className="mt-2 inline-block px-2.5 py-1 bg-muted rounded text-sm font-medium">
              Trend: <span className={marketWeather.trendLabel.includes("BULL") ? "text-success" : marketWeather.trendLabel.includes("BEAR") ? "text-destructive" : ""}>{marketWeather.trendLabel}</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1 max-w-2xl">
            <WeatherMetric label="Perf 5d" value={marketWeather.perf5d} isPercent />
            <WeatherMetric label="Perf 1m" value={marketWeather.perf1m} isPercent />
            <WeatherMetric label="Perf 3m" value={marketWeather.perf3m} isPercent />
            <WeatherMetric label="RSI" value={marketWeather.rsi} isPercent={false} />
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-12">
        {categories.map(cat => {
          const catCandidates = candidates.filter(c => c.category === cat).sort((a, b) => a.rank - b.rank);
          if (catCandidates.length === 0) return null;

          return (
            <div key={cat} className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2 pb-2 border-b border-border">
                <div className="w-2 h-2 rounded-full bg-primary"></div>
                {cat}
                <span className="ml-2 text-sm font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded-full">{catCandidates.length}</span>
              </h3>
              
              <div className="grid gap-4">
                {catCandidates.map(candidate => (
                  <CandidateRow key={candidate.id} candidate={candidate} sessionId={id} quote={quoteMap[candidate.ticker]} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeatherMetric({ label, value, isPercent }: { label: string, value: number, isPercent: boolean }) {
  const colorClass = value > 0 && isPercent ? "text-success" : value < 0 && isPercent ? "text-destructive" : "";
  return (
    <div className="bg-background rounded p-3 border border-border">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`font-mono font-semibold ${colorClass}`}>
        {value > 0 && isPercent ? "+" : ""}{isPercent ? formatPercent(value) : formatNumber(value, 1)}
      </div>
    </div>
  );
}

function CandidateRow({ candidate, sessionId, quote }: { candidate: Candidate, sessionId: number, quote?: QuoteResult }) {
  const updateOutcome = useUpdateCandidateOutcome();
  const queryClient = useQueryClient();
  const mutateFnRef = useRef(updateOutcome.mutate);
  mutateFnRef.current = updateOutcome.mutate;

  const [localOutcome, setLocalOutcome] = useState<CandidateOutcomeProperty>(candidate.outcome);
  const [localExit, setLocalExit] = useState<string>(candidate.exitPrice ? String(candidate.exitPrice) : "");
  
  const handleSave = useCallback(() => {
    mutateFnRef.current(
      { 
        id: candidate.id, 
        data: { 
          outcome: localOutcome as any, 
          exitPrice: localExit ? parseFloat(localExit) : null 
        } 
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetSessionQueryKey(sessionId), (old: any) => {
            if (!old) return old;
            return {
              ...old,
              candidates: old.candidates.map((c: Candidate) => c.id === updated.id ? updated : c)
            };
          });
        }
      }
    );
  }, [candidate.id, localOutcome, localExit, sessionId, queryClient]);

  const isLong = candidate.direction === "LONG";
  const DirIcon = isLong ? TrendingUp : TrendingDown;
  const dirColor = isLong ? "text-success bg-success/10 border-success/20" : "text-destructive bg-destructive/10 border-destructive/20";

  // Live price derived values
  const livePrice = quote?.livePrice ?? null;
  const changePct = quote?.changePct ?? null;
  const distFromEntry = livePrice != null
    ? ((livePrice - candidate.entryPrice) / candidate.entryPrice) * 100
    : null;
  const distFromStop = livePrice != null
    ? ((livePrice - candidate.stopPrice) / candidate.stopPrice) * 100
    : null;
  const pastEntry = livePrice != null && (isLong ? livePrice >= candidate.entryPrice : livePrice <= candidate.entryPrice);
  const nearStop = distFromStop != null && Math.abs(distFromStop) < 1.5;

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm text-sm flex flex-col xl:flex-row gap-4 xl:items-stretch group">
      
      {/* Identity & Core Metrics */}
      <div className="flex flex-col gap-3 min-w-[280px] xl:border-r border-border xl:pr-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground text-xs">#{candidate.rank}</span>
            <span className="font-bold text-lg">{candidate.ticker}</span>
          </div>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${dirColor}`}>
            <DirIcon className="w-3 h-3" /> {candidate.direction}
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-y-2 gap-x-4 text-xs">
          <div><span className="text-muted-foreground block text-[10px]">SCREEN Px</span><span className="font-mono font-medium">{formatNumber(candidate.price)}</span></div>
          <div><span className="text-muted-foreground block text-[10px]">RS3M</span><span className="font-mono">{formatNumber(candidate.rs3m, 1)}</span></div>
          <div><span className="text-muted-foreground block text-[10px]">1M%</span><span className="font-mono">{formatPercent(candidate.perf1m)}</span></div>
          <div><span className="text-muted-foreground block text-[10px]">RSI</span><span className="font-mono">{formatNumber(candidate.rsi, 1)}</span></div>
          <div><span className="text-muted-foreground block text-[10px]">ATR</span><span className="font-mono">{formatNumber(candidate.atr)}</span></div>
          <div><span className="text-muted-foreground block text-[10px]">VOL</span><span className="font-mono">{formatNumber(candidate.volMultiplier)}x</span></div>
        </div>
      </div>

      {/* Live Price */}
      <div className="flex flex-col justify-center min-w-[140px] xl:border-r border-border xl:pr-4">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
          <Activity className="w-3 h-3" /> Live Price
        </div>
        {livePrice != null ? (
          <div className="space-y-1">
            <div className={`font-mono font-bold text-xl ${pastEntry ? (isLong ? "text-success" : "text-destructive") : ""}`}>
              {formatNumber(livePrice)}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {changePct != null && (
                <span className={`font-mono ${changePct >= 0 ? "text-success" : "text-destructive"}`}>
                  {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                </span>
              )}
              {nearStop && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-bold animate-pulse">
                  NEAR STOP
                </span>
              )}
              {pastEntry && !nearStop && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success font-bold">
                  TRIGGERED
                </span>
              )}
            </div>
            {distFromEntry != null && (
              <div className="text-[10px] text-muted-foreground font-mono">
                vs entry: <span className={distFromEntry >= 0 ? "text-success" : "text-destructive"}>
                  {distFromEntry >= 0 ? "+" : ""}{distFromEntry.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground font-mono text-sm">—</div>
        )}
      </div>

      {/* Trade Plan */}
      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 xl:border-r border-border xl:pr-4 py-2 xl:py-0 bg-muted/30 p-3 rounded-md xl:bg-transparent xl:p-0">
        <div className="flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Crosshair className="w-3 h-3"/> Entry</div>
          <div className="font-mono font-semibold text-base">{formatNumber(candidate.entryPrice)}</div>
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> Stop</div>
          <div className="font-mono font-semibold text-destructive">{formatNumber(candidate.stopPrice)}</div>
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Target className="w-3 h-3"/> Target</div>
          <div className="font-mono font-semibold text-success">{formatNumber(candidate.targetPrice)}</div>
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Risk / Reward</div>
          <div className="font-mono font-bold">{formatNumber(candidate.rr)}R</div>
        </div>
      </div>

      {/* Outcome Logger */}
      <div className="min-w-[280px] flex flex-col justify-center gap-2">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Log Outcome</div>
        <div className="flex items-center gap-2">
          <select 
            value={localOutcome}
            onChange={e => setLocalOutcome(e.target.value as CandidateOutcomeProperty)}
            className={`h-8 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-medium flex-1 ${
              localOutcome === "WIN" ? "text-success border-success/50" : 
              localOutcome === "LOSS" ? "text-destructive border-destructive/50" : 
              localOutcome === "SKIP" ? "text-muted-foreground" : ""
            }`}
          >
            <option value="PENDING">PENDING</option>
            <option value="WIN">WIN</option>
            <option value="LOSS">LOSS</option>
            <option value="SKIP">SKIP</option>
          </select>
          
          <input 
            type="number"
            step="0.01"
            placeholder="Exit Px"
            value={localExit}
            onChange={e => setLocalExit(e.target.value)}
            disabled={localOutcome === "PENDING" || localOutcome === "SKIP"}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm font-mono disabled:opacity-50"
          />
          
          <button 
            onClick={handleSave}
            disabled={updateOutcome.isPending || (localOutcome === candidate.outcome && localExit === (candidate.exitPrice ? String(candidate.exitPrice) : ""))}
            className="h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
            title="Save Outcome"
          >
            <RefreshCw className={`w-4 h-4 ${updateOutcome.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

    </div>
  );
}
