import { useGetSession, getGetSessionQueryKey, useGetQuotes, Candidate, CandidateOutcomeProperty, useUpdateCandidateOutcome, QuoteResult } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { formatNumber, formatPercent, formatPct, formatDate } from "../lib/utils";
import { ArrowLeft, TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair, RefreshCw, BarChart2, Activity, AlertTriangle, Clock, Newspaper, ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback, useEffect } from "react";

// ── News types & hook ─────────────────────────────────────────────────────────
interface NewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: number;
}

function useSessionNews(tickers: string[]) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const key = tickers.slice().sort().join(",");

  useEffect(() => {
    if (!key) return;
    setLoading(true);
    fetch(`/api/screener/news?tickers=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((data: NewsItem[]) => setNews(Array.isArray(data) ? data : []))
      .catch(() => setNews([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { news, loading };
}

// ── Edge score helpers ────────────────────────────────────────────────────────
// For EdgeAI sessions: rsi field stores expectancyR × 100; perf1m stores winRate.
// compositeScore = winRate × expectancyR (Kelly-ish proxy).
function edgeScore(c: Candidate): number {
  const expectancyR = c.rsi / 100; // stored as rsi×100
  const winRate = c.perf1m;        // stored as decimal 0-1
  return winRate * expectancyR;
}

function edgeScoreColor(score: number): string {
  if (score >= 0.15) return "text-success border-success/30 bg-success/10";
  if (score >= 0.05) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  return "text-destructive border-destructive/30 bg-destructive/10";
}

function formatTimeAgo(unixSec: number): string {
  const diffMs = Date.now() - unixSec * 1000;
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) return "< 1h";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────
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
  const { news, loading: newsLoading } = useSessionNews(tickers);

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
  const isEdgeAI = (session as any).source === "edgeai";
  const categories = ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] as const;

  // ── Signal age ──────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const sessionMs = new Date(session.date).getTime();
  const todayMs   = new Date(todayStr).getTime();
  const daysOld   = Math.round((todayMs - sessionMs) / 86_400_000);

  // ── Correlation / concentration analysis ────────────────────────────────────
  const pending = candidates.filter(c => c.outcome === "PENDING");
  type GroupKey = string;
  const groups: Record<GroupKey, number> = {};
  pending.forEach(c => {
    const key = `${c.category} ${c.direction}`;
    groups[key] = (groups[key] ?? 0) + 1;
  });
  const correlationWarnings: string[] = [];
  Object.entries(groups).forEach(([key, count]) => {
    if (count >= 2) correlationWarnings.push(`${count}× ${key}`);
  });
  const totalPending = pending.length;
  const dominantCount = Math.max(0, ...Object.values(groups));
  const isHighlyCorrelated = totalPending >= 2 && dominantCount === totalPending;

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

      {/* ── Stale signal warning ── */}
      {daysOld === 1 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-400 text-sm">Signalen är 1 dag gammal</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Kontrollera att priset fortfarande är nära entry — om marknaden sprungit ifrån gäller inte längre samma R/R.
            </p>
          </div>
        </div>
      )}
      {daysOld >= 2 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-destructive text-sm">Signalen är {daysOld} dagar gammal</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gamla setups är sannolikt ogiltiga — entry-priset stämmer troligen inte längre. Verifiera live-pris mot entry för varje kandidat nedan.
            </p>
          </div>
        </div>
      )}

      {/* ── Correlation / concentration notice ── */}
      {correlationWarnings.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-400 text-sm">
              {isHighlyCorrelated ? "Alla " : ""}{totalPending} pendande setups är korrelerade
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {correlationWarnings.join(", ")} — det är inte diversifiering, det är samma edge {isHighlyCorrelated ? "i " + totalPending + " positioner" : "upprepat"}.
              Tar du alla tar du {isHighlyCorrelated ? "exakt" : "i princip"} samma risk flera gånger.
            </p>
          </div>
        </div>
      )}

      {/* EdgeAI Panel — shown when session was imported from EdgeAI */}
      {isEdgeAI && (
        <EdgeAIPanel session={session as any} />
      )}

      {/* Categories */}
      <div className="space-y-12">
        {categories.map(cat => {
          let catCandidates = candidates.filter(c => c.category === cat);
          // For EdgeAI sessions: sort by composite edge score (winRate × expectancyR) descending
          if (isEdgeAI) {
            catCandidates = [...catCandidates].sort((a, b) => edgeScore(b) - edgeScore(a));
          } else {
            catCandidates = catCandidates.sort((a, b) => a.rank - b.rank);
          }
          if (catCandidates.length === 0) return null;

          return (
            <div key={cat} className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2 pb-2 border-b border-border">
                <div className="w-2 h-2 rounded-full bg-primary"></div>
                {cat}
                <span className="ml-2 text-sm font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded-full">{catCandidates.length}</span>
                {isEdgeAI && <span className="ml-1 text-[10px] text-muted-foreground">sorterat efter sannolikhet</span>}
              </h3>
              
              <div className="grid gap-4">
                {catCandidates.map((candidate, idx) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    sessionId={id}
                    quote={quoteMap[candidate.ticker]}
                    daysOld={daysOld}
                    isEdgeAI={isEdgeAI}
                    rank={idx + 1}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Latest News ── */}
      <NewsPanel news={news} loading={newsLoading} />
    </div>
  );
}

// ── EdgeAI system panel ───────────────────────────────────────────────────────
interface EdgeAISessionExtra {
  source: "edgeai" | null;
  edgeRegime: { label?: string; trend?: string; strength?: number } | null;
  edgeExpectancy: number | null;
  edgeWinRate: number | null;
  edgePF: number | null;
  edgeN: number | null;
  candidates: Candidate[];
}

function EdgeAIPanel({ session }: { session: EdgeAISessionExtra }) {
  const resolved = session.candidates.filter(c => c.outcome === "WIN" || c.outcome === "LOSS");
  const wins = resolved.filter(c => c.outcome === "WIN");
  const actualWR = resolved.length > 0 ? wins.length / resolved.length : null;

  const expColor = session.edgeExpectancy != null
    ? session.edgeExpectancy > 0 ? "text-success" : "text-destructive"
    : "";

  const regime = session.edgeRegime;
  const regimeLabel = regime?.label ?? regime?.trend ?? null;

  return (
    <div className="bg-card border border-blue-500/30 rounded-lg p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          EdgeAI — System Edge
        </div>
        {regimeLabel && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
            {regimeLabel}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-background rounded p-3 border border-border">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Expectancy R</div>
          <div className={`font-mono font-bold text-lg ${expColor}`}>
            {session.edgeExpectancy != null ? (session.edgeExpectancy > 0 ? "+" : "") + session.edgeExpectancy.toFixed(2) + "R" : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">per trade OOS</div>
        </div>
        <div className="bg-background rounded p-3 border border-border">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Win Rate OOS</div>
          <div className="font-mono font-bold text-lg">
            {session.edgeWinRate != null ? Math.round(session.edgeWinRate * 100) + "%" : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">historical</div>
        </div>
        <div className="bg-background rounded p-3 border border-border">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Profit Factor</div>
          <div className="font-mono font-bold text-lg">
            {session.edgePF != null ? session.edgePF.toFixed(2) : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">gross W / gross L</div>
        </div>
        <div className="bg-background rounded p-3 border border-border">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">N Trades</div>
          <div className="font-mono font-bold text-lg">
            {session.edgeN ?? "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">sample size</div>
        </div>
      </div>

      {/* Actual vs Expected comparison */}
      {resolved.length > 0 && session.edgeWinRate != null && (
        <div className="bg-muted/40 rounded p-3 border border-border text-sm flex flex-wrap gap-4 items-center">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Actual WR </span>
            <span className={`font-mono font-semibold ${actualWR! >= session.edgeWinRate ? "text-success" : "text-destructive"}`}>
              {Math.round(actualWR! * 100)}%
            </span>
          </div>
          <div className="text-muted-foreground text-xs">vs</div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Edge WR </span>
            <span className="font-mono font-semibold">{Math.round(session.edgeWinRate * 100)}%</span>
          </div>
          <div className="text-muted-foreground text-xs ml-auto">
            {resolved.length} resolved · {session.candidates.filter(c => c.outcome === "PENDING").length} pending
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weather metric tile ───────────────────────────────────────────────────────
function WeatherMetric({ label, value, isPercent }: { label: string, value: number, isPercent: boolean }) {
  const colorClass = value > 0 && isPercent ? "text-success" : value < 0 && isPercent ? "text-destructive" : "";
  return (
    <div className="bg-background rounded p-3 border border-border">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`font-mono font-semibold ${colorClass}`}>
        {value > 0 && isPercent ? "+" : ""}{isPercent ? formatPct(value) : formatNumber(value, 1)}
      </div>
    </div>
  );
}

// ── News panel ────────────────────────────────────────────────────────────────
function NewsPanel({ news, loading }: { news: NewsItem[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Newspaper className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground">Senaste nyheter</span>
        </div>
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (news.length === 0) return null;

  const visible = expanded ? news : news.slice(0, 5);

  return (
    <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Newspaper className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Senaste nyheter</span>
        <span className="ml-auto text-xs text-muted-foreground">{news.length} artiklar</span>
      </div>

      <div className="space-y-1">
        {visible.map((item) => (
          <a
            key={item.uuid}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/60 transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                {item.title}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <span>{item.publisher}</span>
                <span>·</span>
                <span>{formatTimeAgo(item.publishedAt)}</span>
              </div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        ))}
      </div>

      {news.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center py-1"
        >
          {expanded ? "Visa färre" : `Visa ${news.length - 5} till`}
        </button>
      )}
    </div>
  );
}

// ── Candidate row ─────────────────────────────────────────────────────────────
function CandidateRow({
  candidate, sessionId, quote, daysOld, isEdgeAI, rank,
}: {
  candidate: Candidate;
  sessionId: number;
  quote?: QuoteResult;
  daysOld: number;
  isEdgeAI: boolean;
  rank: number;
}) {
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

  // Earnings proximity warning
  const earningsInDays = quote?.earningsInDays ?? null;
  const earningsDate = quote?.earningsDate ?? null;
  const hasEarningsWarning =
    earningsInDays != null && earningsInDays >= 0 && earningsInDays <= 5;
  const earningsBadgeStyle =
    earningsInDays === 0
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : earningsInDays != null && earningsInDays <= 2
      ? "bg-orange-500/15 text-orange-500 border-orange-500/30"
      : "bg-amber-500/15 text-amber-600 border-amber-500/30";
  const earningsLabel =
    earningsInDays === 0
      ? "Rapport idag"
      : earningsInDays === 1
      ? "Rapport imorgon"
      : `Rapport om ${earningsInDays}d`;

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
  const entryDriftPct = distFromEntry != null ? Math.abs(distFromEntry) : 0;
  const entryStale = daysOld >= 1 && entryDriftPct > 2 && candidate.outcome === "PENDING";

  // EdgeAI per-candidate edge score
  const score = edgeScore(candidate);
  const expectancyR = candidate.rsi / 100;
  const winRatePct = Math.round(candidate.perf1m * 100);
  const sampleN = candidate.pctB;
  const barsAgo = Math.round(candidate.distFrom20dH);

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm text-sm flex flex-col xl:flex-row gap-4 xl:items-stretch group">
      
      {/* Identity & Core Metrics */}
      <div className="flex flex-col gap-3 min-w-[280px] xl:border-r border-border xl:pr-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground text-xs">#{rank}</span>
            <span className="font-bold text-lg">{candidate.ticker.replace(/\.ST$/i, "")}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Earnings warning badge */}
            {hasEarningsWarning && (
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${earningsBadgeStyle}`}
                title={`Rapport: ${earningsDate} — undvik att ta nya positioner inom 5 dagar`}
              >
                <AlertTriangle className="w-3 h-3" />
                {earningsLabel}
              </div>
            )}
            {/* Edge probability score badge — only for EdgeAI sessions */}
            {isEdgeAI && (
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold font-mono ${edgeScoreColor(score)}`}
                   title={`Sannolikhet = WR × E[R] = ${winRatePct}% × ${expectancyR.toFixed(2)}R`}>
                E[R] {expectancyR >= 0 ? "+" : ""}{expectancyR.toFixed(2)}
              </div>
            )}
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${dirColor}`}>
              <DirIcon className="w-3 h-3" /> {candidate.direction}
            </div>
          </div>
        </div>
        
        {/* Metrics grid — labels adapt to EdgeAI vs manual */}
        <div className="grid grid-cols-3 gap-y-2 gap-x-4 text-xs">
          <div>
            <span className="text-muted-foreground block text-[10px]">SCREEN Px</span>
            <span className="font-mono font-medium">{formatNumber(candidate.price)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">RS3M</span>
            <span className="font-mono">{formatNumber(candidate.rs3m, 1)}</span>
          </div>
          {isEdgeAI ? (
            <div>
              <span className="text-muted-foreground block text-[10px]">WIN%</span>
              <span className="font-mono">{winRatePct}%</span>
            </div>
          ) : (
            <div>
              <span className="text-muted-foreground block text-[10px]">1M%</span>
              <span className="font-mono">{formatPct(candidate.perf1m)}</span>
            </div>
          )}
          {isEdgeAI ? (
            <div>
              <span className="text-muted-foreground block text-[10px]">E[R]</span>
              <span className={`font-mono font-semibold ${expectancyR > 0 ? "text-success" : "text-destructive"}`}>
                {expectancyR >= 0 ? "+" : ""}{expectancyR.toFixed(2)}
              </span>
            </div>
          ) : (
            <div>
              <span className="text-muted-foreground block text-[10px]">RSI</span>
              <span className="font-mono">{formatNumber(candidate.rsi, 1)}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground block text-[10px]">{isEdgeAI ? "1R" : "ATR"}</span>
            <span className="font-mono">{formatNumber(candidate.atr)}</span>
          </div>
          {isEdgeAI ? (
            <div>
              <span className="text-muted-foreground block text-[10px]">N / {barsAgo}b</span>
              <span className="font-mono">{sampleN > 0 ? Math.round(sampleN) : "—"}</span>
            </div>
          ) : (
            <div>
              <span className="text-muted-foreground block text-[10px]">VOL</span>
              <span className="font-mono">{formatNumber(candidate.volMultiplier)}x</span>
            </div>
          )}
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
              {entryStale && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                  ENTRY ÄNDRAT {entryDriftPct > 5 ? "⚠" : ""}
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
