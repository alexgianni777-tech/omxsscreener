import { useGetSession, getGetSessionQueryKey, useGetQuotes, getGetQuotesQueryKey, Candidate as ApiCandidate, CandidateOutcomeProperty, useUpdateCandidateOutcome, QuoteResult, ImportDiff } from "@workspace/api-client-react";
import { quoteRequestTicker } from "../lib/researchQuote";
import { useParams, Link } from "wouter";
import { formatNumber, formatPercent, formatPct, formatDate } from "../lib/utils";
import { ArrowLeft, TrendingUp, TrendingDown, Target, ShieldAlert, Crosshair, RefreshCw, BarChart2, Activity, AlertTriangle, Clock, ExternalLink, CandlestickChart as CandlestickIcon, Star, Briefcase } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback, useEffect } from "react";
import { CandlestickChart } from "../components/CandlestickChart";
import { AddToPortfolioModal } from "../components/AddToPortfolioModal";
import { edgeAiMetrics, edgeAiScore, edgeAiIndicators } from "../lib/edgeAiMetrics";
import { LiveTop3Preview } from "../components/LiveTop3Preview";
import { CurrentTop3Selection } from "../components/CurrentTop3Selection";
import { RiskPanel } from "../components/RiskPanel";
import { SessionTradePlan } from "../components/SessionTradePlan";
import { LiveEntryGuard } from "../components/LiveEntryGuard";

type Candidate = ApiCandidate & {
  volumeAsOf?: string | null;
  edgeWinRate?: number | null;
  edgeExpectancyR?: number | null;
  edgeSampleN?: number | null;
  signalAgeBars?: number | null;
  maxHoldDays?: number | null;
};

function edgeScoreColor(score: number): string {
  if (score >= 0.15) return "text-success border-success/30 bg-success/10";
  if (score >= 0.05) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  return "text-destructive border-destructive/30 bg-destructive/10";
}

const DECISION_STYLE: Record<string, string> = {
  TRADEABLE: "text-success bg-success/10 border-success/30",
  WAIT: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  BLOCKED: "text-destructive bg-destructive/10 border-destructive/30",
  INVALID: "text-destructive bg-destructive/10 border-destructive/30",
  STALE: "text-amber-500 bg-amber-500/10 border-amber-500/30",
};

const DECISION_LABEL: Record<string, string> = {
  TRADEABLE: "Tradebar",
  WAIT: "Vänta",
  BLOCKED: "Blockerad",
  INVALID: "Ogiltig data",
  STALE: "Inaktuell",
};

// ── Import diff banner — shows exactly what the last (re-)import changed ───────
const FIELD_LABELS: Record<string, string> = {
  entryPrice: "Entry",
  stopPrice: "Stop",
  targetPrice: "Mål",
  rr: "R/R",
  rsi: "RSI",
  volMultiplier: "Volym",
  oneR: "1R",
  rank: "Rank",
  distFrom20dH: "Avst 20dH",
  pctB: "%B",
  atr: "ATR",
  perf1m: "Perf 1m",
  rs3m: "RS3m",
  gapWarning: "Gap-varning",
  earningsInDays: "Dagar till rapport",
  market: "Marknad",
};

function fmtDiffValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function ImportDiffBanner({ diff, importedAt }: { diff: ImportDiff; importedAt?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
  if (!hasChanges) return null;

  return (
    <div className="bg-card border border-blue-500/20 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        data-testid="btn-toggle-import-diff"
      >
        <div className="flex items-center gap-2 text-sm">
          <RefreshCw className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="font-semibold">Senaste importen ändrade</span>
          <span className="flex items-center gap-1.5 text-xs">
            {diff.added.length > 0 && <span className="text-success">+{diff.added.length} nya</span>}
            {diff.updated.length > 0 && <span className="text-amber-400">{diff.updated.length} uppdaterade</span>}
            {diff.removed.length > 0 && <span className="text-destructive">-{diff.removed.length} borttagna</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          {importedAt && <span>{new Date(importedAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}</span>}
          <span>{expanded ? "Dölj" : "Visa detaljer"}</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 text-sm border-t border-border pt-3">
          {diff.added.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-success mb-1 uppercase tracking-wide">Nya kandidater</div>
              <div className="flex flex-wrap gap-1.5">
                {diff.added.map((c) => (
                  <span key={c.identity} className="px-2 py-0.5 rounded bg-success/10 border border-success/20 text-xs font-mono">
                    {c.ticker} <span className="text-muted-foreground">({c.category})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {diff.updated.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-amber-400 mb-1 uppercase tracking-wide">Uppdaterade kandidater</div>
              <div className="space-y-1.5">
                {diff.updated.map((c) => (
                  <div key={c.identity} className="rounded bg-muted/50 border border-border px-2.5 py-1.5 text-xs">
                    <span className="font-mono font-medium">{c.ticker}</span>
                    <span className="text-muted-foreground"> ({c.category}) — </span>
                    {c.changes.map((ch, i) => (
                      <span key={ch.field} className="font-mono">
                        {i > 0 && ", "}
                        {FIELD_LABELS[ch.field] ?? ch.field}: {fmtDiffValue(ch.from)} → {fmtDiffValue(ch.to)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-destructive mb-1 uppercase tracking-wide">Borttagna (obekräftade, saknades i importen)</div>
              <div className="flex flex-wrap gap-1.5">
                {diff.removed.map((c) => (
                  <span key={c.identity} className="px-2 py-0.5 rounded bg-destructive/10 border border-destructive/20 text-xs font-mono">
                    {c.ticker} <span className="text-muted-foreground">({c.category})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function SessionDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { data: session, isLoading, isError, refetch } = useGetSession(id, { query: { enabled: !!id, queryKey: getGetSessionQueryKey(id), refetchInterval: 30_000 } });

  const tickers = session?.candidates.map((c) => quoteRequestTicker(c.ticker, c.market)) ?? [];
  const tickersParam = tickers.join(",");
  const quoteParams = { tickers: tickersParam };
  const { data: quotes, isError: quoteError } = useGetQuotes(
    quoteParams,
    { query: { queryKey: getGetQuotesQueryKey(quoteParams), enabled: tickers.length > 0, refetchInterval: 60_000 } }
  );
  const quoteMap: Record<string, QuoteResult> = {};
  quotes?.forEach((q) => { quoteMap[q.ticker] = quoteError ? { ...q, error: "Kurshämtningen misslyckades." } : q; });

  // Star selections are annotations, capped per market/direction. They are
  // never used to rewrite the immutable official signal-time snapshot.
  const [pickedIdsByGroup, setPickedIdsByGroup] = useState<Record<string, Set<number>>>({});
  const pickGroupKey = (market: string | null | undefined, direction: string) =>
    `${market ?? "unknown"}:${direction === "SHORT" ? "SHORT" : "LONG"}`;
  useEffect(() => {
    if (!session) return;
    const grouped: Record<string, Set<number>> = {};
    session.candidates.forEach((c: any) => {
      if (c.isTop3Pick) {
        const key = pickGroupKey(c.market, c.direction);
        grouped[key] ??= new Set<number>();
        grouped[key].add(c.id);
      }
    });
    setPickedIdsByGroup(grouped);
  }, [session?.id]);

  const togglePick = async (candidateId: number, current: boolean, direction: string, market?: string | null) => {
    const next = !current;
    const groupKey = pickGroupKey(market, direction);
    const currentCount = pickedIdsByGroup[groupKey]?.size ?? 0;
    if (next && currentCount >= 3) return;
    setPickedIdsByGroup((previous) => {
      const nextGroups = { ...previous };
      const nextIds = new Set(nextGroups[groupKey] ?? []);
      next ? nextIds.add(candidateId) : nextIds.delete(candidateId);
      nextGroups[groupKey] = nextIds;
      return nextGroups;
    });
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
    const response = await fetch(`${base}/api/screener/candidates/${candidateId}/top3pick`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isTop3Pick: next }),
    });
    if (!response.ok) {
      setPickedIdsByGroup((previous) => {
        const nextGroups = { ...previous };
        const nextIds = new Set(nextGroups[groupKey] ?? []);
        current ? nextIds.add(candidateId) : nextIds.delete(candidateId);
        nextGroups[groupKey] = nextIds;
        return nextGroups;
      });
    }
  };

  // ── Early returns (after all hooks) ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-8">
        <div className="h-8 w-24 bg-muted rounded"></div>
        <div className="h-32 bg-muted rounded-lg"></div>
        <div className="h-64 bg-muted rounded-lg"></div>
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
        Failed to load session details.
      </div>
    );
  }

  const { marketWeather, candidates } = session;
  const isEdgeAI = candidates.some((candidate) => candidate.signalSource === "edgeai");
  const categories = ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] as const;
  const top3Snapshot = (session as any).top3SelectionSnapshot;
  const totalLongStars = Object.entries(pickedIdsByGroup).filter(([key]) => key.endsWith(":LONG")).reduce((count, [, ids]) => count + ids.size, 0);
  const totalShortStars = Object.entries(pickedIdsByGroup).filter(([key]) => key.endsWith(":SHORT")).reduce((count, [, ids]) => count + ids.size, 0);

  // ── Market state (from first available quote) ─────────────────────────────
  const anyQuote = quotes?.[0];
  const marketState = anyQuote?.marketState ?? null;
  const marketStateLabel =
    marketState === "REGULAR" ? { text: "🟢 Börsen öppen", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" } :
    marketState === "PRE"     ? { text: "🟡 Förbörs", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" } :
    marketState === "POST"    ? { text: "🟡 Efterbörs", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" } :
    marketState != null       ? { text: "⚫ Stängd", cls: "text-muted-foreground bg-muted border-border" } : null;

  // ── Signal age ──────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const sessionMs = new Date(session.date).getTime();
  const todayMs   = new Date(todayStr).getTime();
  const daysOld   = Math.round((todayMs - sessionMs) / 86_400_000);

  // ── Same-setup concentration (not measured market correlation) ────────────
  const pending = candidates.filter(c => c.outcome === "PENDING");
  type GroupKey = string;
  const groups: Record<GroupKey, number> = {};
  pending.forEach(c => {
    const key = `${c.category} ${c.direction}`;
    groups[key] = (groups[key] ?? 0) + 1;
  });
  const concentrationWarnings: string[] = [];
  Object.entries(groups).forEach(([key, count]) => {
    if (count >= 2) concentrationWarnings.push(`${count}× ${key}`);
  });
  const totalPending = pending.length;
  const dominantCount = Math.max(0, ...Object.values(groups));
  const isSingleSetupGroup = totalPending >= 2 && dominantCount === totalPending;

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

      {/* ── Import diff — exactly what the last (re-)import changed ── */}
      {session.importDiff && (
        <ImportDiffBanner diff={session.importDiff} importedAt={session.lastImportAt} />
      )}
      {!!session.top3Revisions?.length && (
        <CurrentTop3Selection revisions={session.top3Revisions} sessionId={session.id} quotes={quoteMap} candidates={session.candidates} />
      )}
      {!session.top3Revisions?.length && session.top3LiveSelection && (
        <LiveTop3Preview
          live={session.top3LiveSelection}
          candidates={candidates}
          frozen={session.top3SelectionSnapshot}
          sessionId={session.id}
          quotes={quoteMap}
          onCutoff={() => { void refetch(); }}
        />
      )}
      <div className={`rounded-lg border px-4 py-3 text-xs ${
        top3Snapshot?.available
          ? "border-primary/20 bg-primary/5 text-muted-foreground"
          : "border-amber-500/30 bg-amber-500/5 text-amber-700"
      }`}>
        {top3Snapshot?.available
          ? `Ursprungligt urval för statistik: ${new Date(top3Snapshot.selectedAt).toLocaleString("sv-SE")} · ${top3Snapshot.policyVersion}. Källor: ${top3Snapshot.participatingSources?.join(" + ") || "äldre policy"}. Aktuella förslag ovan kan uppdateras; denna historik behålls.`
          : `${top3Snapshot?.unavailableReason ?? "Officiellt Top 3-urval saknas för denna session."} Historiken räknas inte om; stjärnor nedan är endast anteckningar.`}
      </div>

      {/* Market Weather Banner */}
      <div className="bg-card border-l-4 border-l-primary border-y border-r border-border rounded-r-lg p-6 shadow-sm">
        <div className="flex flex-col md:flex-row gap-6 md:items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1"><BarChart2 className="w-4 h-4"/> Market Weather</div>
            <div className="text-3xl font-bold font-mono tracking-tight">{formatNumber(marketWeather.omxsValue, 1)}</div>
            <p className="text-xs text-muted-foreground">Historisk sessionsreferens · ej live eller separat verifierat källvärde. Se källkvitton för Telegram/EdgeAI.</p>
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

      {/* ── Data-quality / no-trade banner — same volume & market-RSI reliability
           checks as "Idag", surfaced here too so historical sessions show why
           a setup was blocked or flagged. ── */}
      {session.sessionReview && session.sessionReview.reasons.length > 0 && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${
          session.sessionReview.status === "BLOCKED"
            ? "border-destructive/30 bg-destructive/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}>
          <ShieldAlert className={`w-4 h-4 shrink-0 mt-0.5 ${session.sessionReview.status === "BLOCKED" ? "text-destructive" : "text-amber-400"}`} />
          <div>
            <span className={`font-semibold text-sm ${(session as any).sessionReview.status === "BLOCKED" ? "text-destructive" : "text-amber-400"}`}>
              {session.sessionReview.status === "BLOCKED" ? "No-trade" : "Kontroll före trade"}
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">{session.sessionReview.reasons.join(" ")}</p>
          </div>
        </div>
      )}

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

      {/* ── Same-setup concentration notice ── */}
      {concentrationWarnings.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-400 text-sm">
              Koncentration i liknande setups
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {concentrationWarnings.join(", ")} — {isSingleSetupGroup ? "alla" : "flera"} väntande förslag har samma kategori och riktning.
              Detta visar upprepade setup-etiketter, inte uppmätt korrelation mellan aktier eller likvärdig portföljrisk.
            </p>
          </div>
        </div>
      )}

      {/* ── Live price source + market state ── */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3" />
          Priser: Yahoo Finance · uppdateras var 60:e sekund
        </div>
        {marketStateLabel && (
          <span className={`px-2 py-0.5 rounded border font-medium text-[11px] ${marketStateLabel.cls}`}>
            {marketStateLabel.text}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 font-medium text-xs">
          <div className="flex items-center gap-1">
            <TrendingUp className={`w-3 h-3 ${totalLongStars > 0 ? "text-success" : "text-muted-foreground"}`} />
            <Star className={`w-3 h-3 ${totalLongStars > 0 ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
            <span className={totalLongStars > 0 ? "text-amber-400" : "text-muted-foreground"}>Köp {totalLongStars} stjärnor</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingDown className={`w-3 h-3 ${totalShortStars > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            <Star className={`w-3 h-3 ${totalShortStars > 0 ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
            <span className={totalShortStars > 0 ? "text-amber-400" : "text-muted-foreground"}>Sälj {totalShortStars} stjärnor</span>
          </div>
          {totalLongStars === 0 && totalShortStars === 0 && (
            <span className="text-muted-foreground/60">— stjärnor är anteckningar, max 3 per market/riktning</span>
          )}
        </div>
      </div>

      {/* EdgeAI Panel — shown when session was imported from EdgeAI */}
      {isEdgeAI && (
        <EdgeAIPanel session={session} />
      )}

      {/* Categories */}
      <div className="space-y-12">
        {categories.map(cat => {
          let catCandidates = candidates.filter(c => c.category === cat);
          // EdgeAI candidates sort by their dedicated edge score; legacy metrics
          // are deliberately not interpreted as EdgeAI values.
          if (catCandidates.some((candidate) => candidate.signalSource === "edgeai")) {
            catCandidates = [...catCandidates].sort((a, b) => {
              const aEdge = a.signalSource === "edgeai";
              const bEdge = b.signalSource === "edgeai";
              if (aEdge !== bEdge) return aEdge ? -1 : 1;
              if (!aEdge) return a.rank - b.rank;
              return (edgeAiScore(b) ?? -Infinity) - (edgeAiScore(a) ?? -Infinity) || a.rank - b.rank;
            });
          } else if (cat === "MOMENTUM") {
            // #58: Momentum should reward stocks with actual price gains, not just
            // the source list's own line order — sort by relative strength (rs3m)
            // then 1-month performance, both descending, before falling back to rank.
            catCandidates = [...catCandidates].sort(
              (a, b) => (b.rs3m - a.rs3m) || (b.perf1m - a.perf1m) || (a.rank - b.rank),
            );
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
                {catCandidates.some((candidate) => candidate.signalSource === "edgeai") && <span className="ml-1 text-[10px] text-muted-foreground">sorterat efter EdgeAI-data</span>}
              </h3>
              
              <div className="grid gap-4">
                {catCandidates.map((candidate, idx) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    sessionId={id}
                    quote={quoteMap[quoteRequestTicker(candidate.ticker, candidate.market)]}
                    daysOld={daysOld}
                    isEdgeAI={candidate.signalSource === "edgeai"}
                    rank={idx + 1}
                    isPicked={pickedIdsByGroup[pickGroupKey(candidate.market, candidate.direction)]?.has(candidate.id) ?? false}
                    pickedCount={pickedIdsByGroup[pickGroupKey(candidate.market, candidate.direction)]?.size ?? 0}
                    onTogglePick={(candidateId, current, direction) => togglePick(candidateId, current, direction, candidate.market)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

// ── EdgeAI system panel ───────────────────────────────────────────────────────
interface EdgeAISessionExtra {
  source: string | null;
  edgeRegime?: { label?: string; trend?: string; strength?: number } | null;
  edgeExpectancy?: number | null;
  edgeWinRate?: number | null;
  edgePF?: number | null;
  edgeN?: number | null;
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

// ── Candidate row ─────────────────────────────────────────────────────────────
function CandidateRow({
  candidate, sessionId, quote, daysOld, isEdgeAI, rank, isPicked, pickedCount, onTogglePick,
}: {
  candidate: Candidate;
  sessionId: number;
  quote?: QuoteResult;
  daysOld: number;
  isEdgeAI: boolean;
  rank: number;
  isPicked: boolean;
  pickedCount: number;
  onTogglePick: (id: number, current: boolean, direction: string) => void;
}) {
  const updateOutcome = useUpdateCandidateOutcome();
  const queryClient = useQueryClient();
  const mutateFnRef = useRef(updateOutcome.mutate);
  mutateFnRef.current = updateOutcome.mutate;

  const [localOutcome, setLocalOutcome] = useState<CandidateOutcomeProperty>(candidate.outcome);
  const [localExit, setLocalExit] = useState<string>(candidate.exitPrice ? String(candidate.exitPrice) : "");
  const [resolutionMethod, setResolutionMethod] = useState<"MANUAL_EXIT" | "TARGET_HIT" | "STOP_HIT" | "TIME_EXIT">(
    candidate.resolutionMethod === "TARGET_HIT" || candidate.resolutionMethod === "STOP_HIT" || candidate.resolutionMethod === "TIME_EXIT"
      ? candidate.resolutionMethod
      : "MANUAL_EXIT",
  );
  const [actualExitConfirmed, setActualExitConfirmed] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [showAddToPortfolio, setShowAddToPortfolio] = useState(false);
  
  const handleSave = useCallback((removeChallengeTrade?: boolean) => {
    mutateFnRef.current(
      { 
        id: candidate.id, 
        data: { 
          outcome: localOutcome as any, 
          exitPrice: localExit ? parseFloat(localExit) : null,
          ...(localOutcome === "WIN" || localOutcome === "LOSS" || localOutcome === "TIME_EXIT"
            ? {
                resolutionMethod: localOutcome === "TIME_EXIT" ? "TIME_EXIT" : resolutionMethod,
                ...((resolutionMethod === "MANUAL_EXIT" || localOutcome === "TIME_EXIT") ? { actualExitConfirmed } : {}),
              }
            : {}),
          ...(removeChallengeTrade ? { removeChallengeTrade: true } : {}),
        } as any
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
        },
        onError: (err: any) => {
          // 409 = outcome change would silently orphan/drop a logged Challenge
          // Tracker trade; require the user's explicit confirmation.
          if (err?.status === 409) {
            if (localOutcome === "WIN" || localOutcome === "LOSS") {
              window.alert(
                err?.data?.error ??
                "Den kopplade Challenge Tracker-traden kunde inte uppdateras säkert. Öppna Challenge Tracker och ange riskallokeringen innan du försöker igen."
              );
              return;
            }
            const existing = err?.data?.existingChallengeTrade;
            const pnl = existing?.pnlKr;
            const confirmed = window.confirm(
              pnl != null
                ? `Detta utfall är kopplat till en loggad Challenge Tracker-trade (${pnl} kr). Ta bort den kopplade tradelogg-posten?`
                : "Detta utfall är kopplat till en loggad Challenge Tracker-trade. Ta bort den kopplade tradelogg-posten?"
            );
            if (confirmed) {
              handleSaveRef.current(true);
            }
          }
        },
      }
    );
  }, [candidate.id, localOutcome, localExit, resolutionMethod, actualExitConfirmed, sessionId, queryClient]);
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const isLong = candidate.direction === "LONG";
  const DirIcon = isLong ? TrendingUp : TrendingDown;
  const dirColor = isLong ? "text-success bg-success/10 border-success/20" : "text-destructive bg-destructive/10 border-destructive/20";

  // Earnings proximity warning
  const earningsInDays = quote?.earningsInDays ?? null;
  const earningsDate = quote?.earningsDate ?? null;
  const hasEarningsWarning =
    earningsInDays != null && earningsInDays >= 0 && earningsInDays <= 5;
  const signalEarningsKnown = candidate.earningsKnowledge === "SIGNAL_TIME";
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
  const targetPct = candidate.entryPrice > 0 && candidate.targetPrice > 0
    ? Math.abs((candidate.targetPrice - candidate.entryPrice) / candidate.entryPrice * 100)
    : 0;
  const isTargetFar = targetPct > 10;
  const stopPct = candidate.entryPrice > 0 && candidate.stopPrice > 0
    ? Math.abs((candidate.stopPrice - candidate.entryPrice) / candidate.entryPrice * 100)
    : null;
  const refPrice = livePrice ?? candidate.price;
  const entryGapPct = refPrice > 0
    ? ((candidate.entryPrice - refPrice) / refPrice * 100)
    : null;

  const edgeMetrics = edgeAiMetrics(candidate);
  const measured = edgeAiIndicators(candidate);
  const score = edgeAiScore(candidate);
  const decision = candidate.decision;

  return (
    <div
      className="bg-card border border-border rounded-lg shadow-sm text-sm group"
      data-testid={isEdgeAI ? `edgeai-candidate-${candidate.id}` : undefined}
    >
    <div data-testid={`session-candidate-layout-${candidate.id}`} className="grid min-w-0 grid-cols-1 gap-4 p-4 xl:grid-cols-2">
      
      {/* Identity & Core Metrics */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground text-xs">#{rank}</span>
            <span className="font-bold text-lg">{candidate.ticker.replace(/\.ST$/i, "")}</span>
            {(candidate as any).officialSelection?.selected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary">
                Signal-time Top 3 #{(candidate as any).officialSelection.rank}
              </span>
            )}
            <button
              onClick={() => setShowChart((v) => !v)}
              title="Visa/dölj kursdiagram med Bollinger Bands"
              className={`p-1 rounded transition-colors ${showChart ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              <CandlestickIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onTogglePick(candidate.id, isPicked, candidate.direction)}
              disabled={!isPicked && pickedCount >= 3}
              title={isPicked ? "Ta bort stjärnanteckning" : pickedCount >= 3 ? "Max 3 stjärnanteckningar per market/riktning" : "Lägg till stjärnanteckning (ändrar inte officiellt urval)"}
              className={`p-1 rounded transition-colors ${
                isPicked
                  ? "text-amber-400 hover:text-amber-300"
                  : pickedCount >= 3
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : "text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10"
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${isPicked ? "fill-amber-400" : ""}`} />
            </button>
            <button
              onClick={() => setShowAddToPortfolio(true)}
              title="Lägg till som portföljposition"
              className="p-1 rounded transition-colors text-muted-foreground hover:text-primary hover:bg-primary/10"
            >
              <Briefcase className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Data-quality / risk review badge — volume, market-RSI and other
                screeningReview checks (same rules as "Idag") */}
            {(candidate as any).review && (candidate as any).review.status !== "APPROVED" && (
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${
                  (candidate as any).review.status === "BLOCKED"
                    ? "text-destructive bg-destructive/10 border-destructive/30"
                    : "text-amber-500 bg-amber-500/10 border-amber-500/30"
                }`}
                title={(candidate as any).review.reasons.join(" ")}
              >
                <ShieldAlert className="w-3 h-3" />
                {(candidate as any).review.status === "BLOCKED" ? "Stoppad" : "Kontroll"}
              </div>
            )}
            {/* Earnings warning badge */}
            {!signalEarningsKnown && (
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold text-muted-foreground bg-muted border-border"
                title="Det saknas en verifierad rapportkalender från signal-dagen. Regel 7 kan inte bedömas historiskt."
              >
                <Clock className="w-3 h-3" />
                Regel 7: okänd
              </div>
            )}
            {hasEarningsWarning && (
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${earningsBadgeStyle}`}
                title={`Nuvarande Yahoo-kalender: rapport ${earningsDate}. Detta ändrar inte signal-dagens Regel 7-bedömning.`}
              >
                <AlertTriangle className="w-3 h-3" />
                Nu: {earningsLabel}
              </div>
            )}
            {/* Edge probability score badge — only for EdgeAI sessions */}
            {isEdgeAI && (
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold font-mono ${
                  score == null ? "text-muted-foreground border-border bg-muted" : edgeScoreColor(score)
                }`}
                title={score == null ? "EdgeAI-score okänd: dedikerade fält saknas" : "EdgeAI-score baserad på dedikerad expectancy, sample size och signalålder"}
              >
                Edge {score == null ? "okänd" : score.toFixed(2)}
              </div>
            )}
            {isTargetFar && (
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold text-amber-500 bg-amber-500/10 border-amber-500/30"
                title={`Target är ${targetPct.toFixed(1)}% från entry — möjligen swing-trade tidshorisont`}
              >
                ⚠ +{targetPct.toFixed(0)}%
              </div>
            )}
            {candidate.direction === "SHORT" && isEdgeAI && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold text-amber-500 bg-amber-500/10 border-amber-500/30"
                   title="Short-strategin är i beta — edge valideras fortfarande">
                BETA
              </div>
            )}
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${dirColor}`}>
              <DirIcon className="w-3 h-3" /> {candidate.direction}
            </div>
          </div>
        </div>
          {decision && (
            <div className={`rounded border px-2.5 py-2 text-xs ${DECISION_STYLE[decision.status]}`}>
              <div className="flex items-center gap-1 font-bold">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                Screeningstatus: {decision.status} · {DECISION_LABEL[decision.status] ?? decision.status}
              </div>
              <p className="mt-1 leading-relaxed opacity-90">{decision.reasons.join(" ")}</p>
            </div>
          )}
        
        <LiveEntryGuard plan={candidate} quote={quote} signal={candidate} />
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
              <span className="font-mono">{edgeMetrics.winRate == null ? "okänd" : `${Math.round(edgeMetrics.winRate * 100)}%`}</span>
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
              <span className={`font-mono font-semibold ${
                edgeMetrics.expectancyR == null ? "text-muted-foreground" : edgeMetrics.expectancyR > 0 ? "text-success" : "text-destructive"
              }`}>
                {edgeMetrics.expectancyR == null ? "okänd" : `${edgeMetrics.expectancyR >= 0 ? "+" : ""}${edgeMetrics.expectancyR.toFixed(2)}R`}
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
            <span className="font-mono">{isEdgeAI
              ? measured.oneR == null ? "saknas" : formatNumber(measured.oneR)
              : candidate.atr > 0 ? formatNumber(candidate.atr) : "saknas"}</span>
          </div>
          {isEdgeAI ? (
            <>
              <div>
                <span className="text-muted-foreground block text-[10px]">RSI · signal</span>
                <span className="font-mono">{measured.rsi == null ? "saknas" : formatNumber(measured.rsi, 1)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Sample N</span>
                <span className="font-mono">{edgeMetrics.sampleN == null ? "okänd" : Math.round(edgeMetrics.sampleN)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Signalålder</span>
                <span className="font-mono">{edgeMetrics.signalAgeBars == null ? "okänd" : `${edgeMetrics.signalAgeBars} bars`}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Max innehav</span>
                <span className="font-mono">{edgeMetrics.maxHoldDays == null ? "okänd" : `${edgeMetrics.maxHoldDays} dagar`}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">VOL</span>
                <span className="font-mono">{measured.volume != null
                  ? `${candidate.volMultiplier.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x · stängd ${candidate.volumeAsOf || "datum saknas"}${candidate.volumeAsOf && candidate.signalDate && candidate.volumeAsOf < candidate.signalDate ? " (före signal)" : ""}`
                  : "saknas"}</span>
              </div>
            </>
          ) : (
            <div>
              <span className="text-muted-foreground block text-[10px]">VOL</span>
              <span className="font-mono">{candidate.volMultiplier > 0
                ? `${candidate.volMultiplier.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x · stängd ${candidate.volumeAsOf || "datum saknas"}${candidate.volumeAsOf && candidate.signalDate && candidate.volumeAsOf < candidate.signalDate ? " (före signal)" : ""}`
                : "saknas"}</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Price */}
      <div className="flex min-w-0 flex-col justify-center">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
          <Activity className="w-3 h-3" /> Marknadskurs · ej garanterat live
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
      <SessionTradePlan plan={candidate} entryGapPct={entryGapPct} stopPct={stopPct} targetPct={targetPct} />

      <RiskPanel plan={candidate} realizedR={candidate.realizedR} />
      {/* Outcome Logger */}
      <div className="col-span-full flex min-w-0 flex-col justify-center gap-2">
        <div className="flex items-center gap-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Log Outcome</div>
          {(candidate.outcome === "WIN" || candidate.outcome === "LOSS") && (
            candidate.hasLinkedTrade ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/20" title="Loggad i Challenge Tracker">
                🔗 loggad
              </span>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20" title="Inget resultat loggat i Challenge Tracker">
                ⚠ ej loggad
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={localOutcome}
            onChange={e => {
              const next = e.target.value as CandidateOutcomeProperty;
              setLocalOutcome(next);
              if (next === "TIME_EXIT") {
                setResolutionMethod("TIME_EXIT");
                setActualExitConfirmed(false);
              }
            }}
            className={`h-8 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-medium flex-1 ${
              localOutcome === "WIN" ? "text-success border-success/50" : 
              localOutcome === "LOSS" ? "text-destructive border-destructive/50" : 
              localOutcome === "SKIP" ? "text-muted-foreground" : ""
            }`}
          >
            <option value="PENDING">PENDING</option>
            <option value="WIN">WIN</option>
            <option value="LOSS">LOSS</option>
             <option value="TIME_EXIT">TIME EXIT</option>
            <option value="SKIP">SKIP</option>
          </select>
          
          <input 
            type="number"
            step="0.01"
            placeholder="Exit Px"
            value={localExit}
            onChange={e => setLocalExit(e.target.value)}
            disabled={localOutcome === "PENDING" || localOutcome === "SKIP" || (resolutionMethod !== "MANUAL_EXIT" && resolutionMethod !== "TIME_EXIT")}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm font-mono disabled:opacity-50"
          />
          
          <button 
            onClick={() => handleSave()}
            disabled={
              updateOutcome.isPending ||
              ((localOutcome === "WIN" || localOutcome === "LOSS" || localOutcome === "TIME_EXIT") && (resolutionMethod === "MANUAL_EXIT" || resolutionMethod === "TIME_EXIT") && !localExit) ||
               ((localOutcome === "WIN" || localOutcome === "LOSS" || localOutcome === "TIME_EXIT") && (resolutionMethod === "MANUAL_EXIT" || resolutionMethod === "TIME_EXIT") && !actualExitConfirmed) ||
              (localOutcome === candidate.outcome && localExit === (candidate.exitPrice ? String(candidate.exitPrice) : ""))
            }
            className="h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
            title="Save Outcome"
          >
            <RefreshCw className={`w-4 h-4 ${updateOutcome.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
        {(localOutcome === "WIN" || localOutcome === "LOSS" || localOutcome === "TIME_EXIT") && (
          <>
            <select
              value={resolutionMethod}
              onChange={(e) => {
                const method = e.target.value as "MANUAL_EXIT" | "TARGET_HIT" | "STOP_HIT" | "TIME_EXIT";
                setResolutionMethod(method);
                if (method === "TARGET_HIT") setLocalExit(String(candidate.targetPrice));
                if (method === "STOP_HIT") setLocalExit(String(candidate.stopPrice));
              }}
              className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs"
              aria-label="Resolution method"
            >
              <option value="MANUAL_EXIT">Faktiskt exit-pris (manuellt)</option>
              {localOutcome === "TIME_EXIT" && <option value="TIME_EXIT">Faktiskt pris vid tidsutgång</option>}
              {localOutcome === "WIN" && <option value="TARGET_HIT">Antag target träffad</option>}
              {localOutcome === "LOSS" && <option value="STOP_HIT">Antag stop träffad</option>}
            </select>
            {resolutionMethod === "MANUAL_EXIT" || resolutionMethod === "TIME_EXIT" ? (
              <label className="flex items-start gap-2 text-[10px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={actualExitConfirmed}
                  onChange={(e) => setActualExitConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Jag bekräftar att detta är mitt faktiska genomförda exit-fyllnad, inte en Yahoo/live-kurs.</span>
              </label>
            ) : (
              <p className="text-[10px] text-amber-500">Plan-nivå antas. Använd bara när ordningen är känd; OHLC kan inte avgöra stop/target-ordning.</p>
            )}
          </>
        )}
        {candidate.realizedR != null && (
          <p className="text-[10px] text-muted-foreground">
            Realiserat: <span className="font-mono font-semibold">{candidate.realizedR >= 0 ? "+" : ""}{candidate.realizedR.toFixed(2)}R</span>
            {candidate.resolutionQuality === "ASSUMED_LEVEL" ? " · antagen nivå" : candidate.resolutionQuality === "RECORDED_EXIT" ? " · registrerat exit" : ""}
          </p>
        )}
      </div>

    </div>

    {/* Expandable candlestick + Bollinger chart */}
    {showChart && (
      <div className="border-t border-border/50 px-4 pb-4 pt-3 bg-muted/20">
        <CandlestickChart
          ticker={candidate.ticker}
          entryPrice={candidate.entryPrice}
          stopPrice={candidate.stopPrice}
          targetPrice={candidate.targetPrice}
          height={320}
        />
      </div>
    )}

    {showAddToPortfolio && (
      <AddToPortfolioModal
        prefill={{
          ticker: candidate.ticker,
          direction: candidate.direction as "LONG" | "SHORT",
          market: candidate.market,
          entryPrice: candidate.entryPrice,
          stopPrice: candidate.stopPrice,
          targetPrice: candidate.targetPrice,
        }}
        onClose={() => setShowAddToPortfolio(false)}
        onSuccess={() => {}}
      />
    )}
    </div>
  );
}
