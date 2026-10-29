import { SwedishResearch } from "../components/SwedishResearch";
import { DailyCandidates } from "../components/DailyCandidates";
import { SavedTop3 } from "../components/SavedTop3";
import { MarketIntelSection } from "./dashboard";
import { formatPrice, formatRR } from "../lib/presentationNumbers";
import type { SessionSourceReport } from "@workspace/api-client-react";
/**
 * Idag — daglig briefing + challenge-tracker i ett
 *
 * Flöde:
 *  1. Hämta senaste screener-session → visa top 3 picks med entry/stop/target
 *  2. Hämta challenge-tracker → visa kontobalans & framsteg mot målet
 *  3. Klicka VANN / FÖRLORADE per pick → loggar till challenge + markerar utfall
 *  4. "Kolla priser" → hämtar live-priser via Yahoo Finance, auto-föreslår utfall
 */
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Trophy, ChevronRight,
  Target, Settings2, CheckCircle2, XCircle, RefreshCw, Zap, AlertTriangle,
  Star,
} from "lucide-react";
import { LiveTop3Preview, DecisionBadge, EdgeAiStatusTotals, type LiveSelection } from "../components/LiveTop3Preview";
import { TodayDiagnostics } from "../components/TodayDiagnostics";
import { CurrentTop3Selection } from "../components/CurrentTop3Selection";
import { LiveEntryGuard } from "../components/LiveEntryGuard";
import type { Top3Revision } from "@workspace/api-client-react";
import { edgeAiMetrics } from "../lib/edgeAiMetrics";
import { createLatestRequestGuard } from "../lib/latestRequestGuard";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `${BASE}/api${p}`;

// ── helpers ───────────────────────────────────────────────────────────────────

function kr(n: number, dec = 0) {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " kr";
}

function pct(n: number, dec = 1) {
  return (n >= 0 ? "+" : "") + n.toFixed(dec) + "%";
}

function todayISO() {
  // Stockholm calendar date, independent of browser timezone
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}

function sessionLabel(date: string): string {
  const today = todayISO();
  const yesterday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(Date.now() - 86_400_000));
  if (date === today) return "IDAG";
  if (date === yesterday) return "IGÅR";
  return new Date(date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("sv-SE", { weekday: "long", month: "short", day: "numeric" });
  } catch { return iso; }
}

// ── types ─────────────────────────────────────────────────────────────────────

type Candidate = {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  category: "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST";
  rank: number;
  isTop3Pick: boolean;
  rs3m: number;
  perf1m: number;
  rsi: number;
  distFrom20dH: number;
  outcome: string;
  earningsInDays: number | null;
  market: "SE" | "US" | null;
  signalSource: "edgeai" | "telegram" | "manual" | "screener" | null;
  edgeWinRate?: number | null;
  edgeExpectancyR?: number | null;
  edgeSampleN?: number | null;
  signalAgeBars?: number | null;
  maxHoldDays?: number | null;
  pctB: number;
  volMultiplier: number;
  volumeAsOf?: string | null;
  signalDate?: string | null;
  createdAt?: string | null;
  signalRsi?: number | null;
  signalGapPct?: number | null;
  review?: { status: "APPROVED" | "WARN" | "BLOCKED"; reasons: string[] };
  decision?: { status: "TRADEABLE" | "WAIT" | "BLOCKED" | "INVALID" | "STALE" | "CONFLICT"; reasons: string[] };
  officialSelection?: {
    selected: boolean;
    rank: number | null;
    score: number;
    decision?: { status: "TRADEABLE" | "WAIT" | "BLOCKED" | "INVALID" | "STALE" | "CONFLICT"; reasons: string[] };
    policyVersion: string;
    selectedAt: string;
    type: string;
    market: "SE" | "US" | null;
    direction: "LONG" | "SHORT";
    source: string | null;
  } | null;
};

type Session = {
  id: number;
  date: string;
  source: string | null;
  createdAt: string | null;
  lastImportAt?: string | null;
  marketWeather: {
    omxsValue: number;
    perf5d: number;
    perf1m: number;
    perf3m: number;
    rsi: number;
    trendLabel: string;
  } | null;
  candidates: Candidate[];
  top3LiveSelection?: LiveSelection | null;
  top3Revisions?: Top3Revision[];
  sourceReports?: SessionSourceReport[];
  top3SelectionSnapshot?: {
    available: boolean;
    state: "AVAILABLE" | "WAITING_FOR_CUTOFF" | "WAITING_FOR_SOURCES" | "EVALUATING" | "MISSING_SOURCES" | "LEGACY_UNAVAILABLE";
    unavailableReason: string | null;
    selectedAt: string | null;
    policyVersion: string | null;
    cutoffAt: string | null;
    evaluatedAt: string | null;
    participatingSources: string[] | null;
    requiredSources: string[];
  };
  sessionReview?: { status: "APPROVED" | "WARN" | "BLOCKED"; reasons: string[]; tradableCount: number };
};

type ChallengeData = {
  config: { startCapital: number; goalCapital: number; currentCapital: number | null; riskPct: number };
  stats: { equity: number; totalTrades: number; wins: number; losses: number };
};

type LiveQuote = {
  livePrice: number | null;
  changePct: number | null;
  asOf: string | null;
  fetchedAt: string | null;
  error: string | null;
  marketState: string | null;
};

/** Human-readable "how long ago" for a timestamp, in Swedish. */
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just nu";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} tim`;
  const days = Math.floor(hours / 24);
  return `${days} dygn`;
}

// ── main ─────────────────────────────────────────────────────────────────────

export function Today() {
  const [session, setSession] = useState<Session | null>(null);
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [challengeLoadError, setChallengeLoadError] = useState<string | null>(null);
  const refreshGuard = useRef(createLatestRequestGuard());

  // per-trade logging state
  const [logging, setLogging] = useState<number | null>(null); // candidate id
  const [submitting, setSubmitting] = useState(false);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  // live Yahoo Finance prices
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [checkingPrices, setCheckingPrices] = useState(false);

  // risk % stored on server (survival_config.risk_pct)
  const [riskPct, setRiskPct] = useState<number>(2);
  const [editingRisk, setEditingRisk] = useState(false);
  const [riskInput, setRiskInput] = useState("2");

  const saveRisk = async () => {
    const v = parseFloat(riskInput);
    if (!isNaN(v) && v > 0 && v <= 100) {
      const response = await fetch(api("/survival/config"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskPct: v }),
      });
      if (!response.ok) {
        setOutcomeError("Kunde inte uppdatera risknivån. Försök igen.");
        return;
      }
      setRiskPct(v);
    }
    setEditingRisk(false);
  };

  const load = async () => {
    const isCurrent = refreshGuard.current.begin();
    try {
      const [sessionsResponse, challengeResponse] = await Promise.all([
        fetch(api("/screener/sessions")),
        fetch(api("/survival")).catch(() => null),
      ]);
      if (!isCurrent()) return;

      if (challengeResponse?.ok) {
        try {
          const challengeRes = await challengeResponse.json();
          if (!isCurrent()) return;
          if (challengeRes) {
            setChallenge(challengeRes);
            const serverRisk = challengeRes.config?.riskPct;
            if (typeof serverRisk === "number" && serverRisk > 0) {
              setRiskPct(serverRisk);
              setRiskInput(String(serverRisk));
            }
          } else {
            setChallenge(null);
          }
          setChallengeLoadError(null);
        } catch {
          setChallengeLoadError("Challenge-svaret kunde inte läsas; senast känt värde behålls.");
        }
      } else {
        setChallengeLoadError("Challenge-status kunde inte hämtas; senast känt värde behålls.");
      }

      if (!sessionsResponse.ok) throw new Error(`Kunde inte hämta senaste sessionen (${sessionsResponse.status}).`);
      const sessionsRes = await sessionsResponse.json();
      if (!Array.isArray(sessionsRes)) throw new Error("Svaret för senaste sessionen var ogiltigt.");

      if (sessionsRes.length > 0) {
        const latest = sessionsRes[0];
        const detailResponse = await fetch(api(`/screener/sessions/${latest.id}`));
        if (!detailResponse.ok) throw new Error(`Kunde inte hämta sessionsdetaljer (${detailResponse.status}).`);
        const detail = await detailResponse.json();
        if (!isCurrent()) return;
        setSession(detail);
      } else {
        setSession(null);
      }
      setSessionLoadError(null);
    } catch {
      if (isCurrent()) setSessionLoadError("Senaste sessionen kunde inte uppdateras. Visat underlag kan vara äldre; kontrollera källstatus innan beslut.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Refresh source arrivals and the official cutoff result without manual reload.
    const interval = setInterval(load, 30_000);
    return () => {
      clearInterval(interval);
      refreshGuard.current.invalidate();
    };
  }, []);

  // ── derived ───────────────────────────────────────────────────────────────

  const account = challenge
    ? (challenge.config.currentCapital ?? challenge.stats.equity)
    : null;

  const goalCapital = challenge?.config.goalCapital ?? 10_000_000;
  const startCapital = challenge?.config.startCapital ?? 10_000;
  const tradeCount = challenge?.stats.totalTrades ?? 0;

  const goalPct = account != null
    ? Math.min(100, ((account - startCapital) / (goalCapital - startCapital)) * 100)
    : 0;
  const isToday = session?.date === todayISO();

  // The server's immutable signal-time snapshot is the only official Top 3
  // source. Stars remain annotations and never recalculate this list.
  function selectPicks(cands: Candidate[], n = 3): Candidate[] {
    return cands
      .filter((candidate) => candidate.officialSelection?.selected === true)
      .sort((a, b) => (a.officialSelection?.rank ?? Infinity) - (b.officialSelection?.rank ?? Infinity))
      .slice(0, n);
  }

  const allCandidates = session?.candidates ?? [];
  const edgeAiCandidates = allCandidates.filter(c => c.signalSource === "edgeai");
  const hasMarket = allCandidates.some(c => c.market != null);
  // LONG (köp) and SHORT (sälj) are separate pick pools
  const longCands = allCandidates.filter(c => c.direction !== "SHORT");
  const shortCands = allCandidates.filter(c => c.direction === "SHORT");
  const sePicks = hasMarket ? selectPicks(longCands.filter(c => c.market === "SE")) : [];
  const usPicks = hasMarket ? selectPicks(longCands.filter(c => c.market === "US")) : [];
  const seShortPicks = hasMarket ? selectPicks(shortCands.filter(c => c.market === "SE")) : [];
  const usShortPicks = hasMarket ? selectPicks(shortCands.filter(c => c.market === "US")) : [];
  // LONG picks first, SHORT picks last — a "Topp 3 Sälj" divider renders between them
  const picks: Candidate[] = hasMarket
    ? [...sePicks, ...usPicks, ...seShortPicks, ...usShortPicks]
    : [...selectPicks(longCands), ...selectPicks(shortCands)];
  // ── Market regime flags (hoisted so picks.map can reference them) ─────────────
  const mw = session?.marketWeather;
  const isRiskOff = /risk.?off|motvind|kontrak/i.test(mw?.trendLabel ?? "");
  const isRsiHigh = (mw?.rsi ?? 0) > 0 && (mw?.rsi ?? 0) > 75;
  const isRsiLow  = (mw?.rsi ?? 0) > 0 && (mw?.rsi ?? 0) < 25;

  // risk amounts per pick
  const riskKr = account != null ? account * (riskPct / 100) : null;
  const riskForCandidate = (candidate: Candidate) => {
    if (riskKr == null) return null;
    const sameDirection = picks.filter((pick) => pick.direction === candidate.direction).length;
    // Two similar directional trades already carry correlated index exposure.
    // Keep the group's total risk within the configured per-direction budget.
    return riskKr / Math.max(1, sameDirection);
  };

  // ── Yahoo Finance price check ─────────────────────────────────────────────

  const currentRevision = [...(session?.top3Revisions ?? [])].sort((a, b) => b.revision - a.revision)[0];
  const entryTickers = [...new Set([
    ...picks.map(p => p.ticker),
    ...(currentRevision?.picks ?? []).map(p => p.ticker),
    ...(session?.top3LiveSelection?.picks ?? []).flatMap(p => {
      const candidate = session?.candidates.find(c => c.id === p.candidateId);
      return candidate ? [candidate.ticker] : [];
    }),
  ])];
  const fetchLivePrices = async () => {
    if (entryTickers.length === 0 || checkingPrices) return;
    setCheckingPrices(true);
    try {
      const tickers = entryTickers.join(",");
      const res = await fetch(api(`/screener/quotes?tickers=${encodeURIComponent(tickers)}`));
      if (!res.ok) { setQuotes({}); return; }
      const data = await res.json();
      const map: Record<string, LiveQuote> = {};
      for (const q of data) {
        map[q.ticker] = { livePrice: q.livePrice, changePct: q.changePct, asOf: q.asOf ?? null, fetchedAt: q.fetchedAt ?? null, error: q.error, marketState: q.marketState ?? null };
      }
      setQuotes(map);
    } catch {
      // Never let an unsuccessful refresh leave a cached READY indication.
      setQuotes({});
    } finally {
      setCheckingPrices(false);
    }
  };

  /** Returns "WIN", "LOSS", or null based on live price vs stop/target */
  function autoDetectOutcome(candidate: Candidate): "WIN" | "LOSS" | null {
    const q = quotes[candidate.ticker];
    if (!q?.livePrice) return null;
    const price = q.livePrice;
    if (candidate.direction === "LONG") {
      if (price >= candidate.targetPrice) return "WIN";
      if (price <= candidate.stopPrice) return "LOSS";
    } else {
      if (price <= candidate.targetPrice) return "WIN";
      if (price >= candidate.stopPrice) return "LOSS";
    }
    return null;
  }

  // ── log outcome ───────────────────────────────────────────────────────────

  const logOutcome = async (candidate: Candidate, outcome: "WIN" | "LOSS") => {
    if (!session || submitting) return;
    setSubmitting(true);
    setOutcomeError(null);
    try {
      // Candidate outcome and the optional Challenge Tracker trade are one
      // idempotent server operation. A retry cannot create a duplicate trade.
      // Yahoo can signal that a level is currently crossed, but it is not an
      // execution report. Quick actions therefore always record the relevant
      // planned level as an explicit assumption, never the live quote as an
      // actual/manual exit.
      const exitPrice = outcome === "WIN" ? candidate.targetPrice : candidate.stopPrice;
      const realizedR = candidate.direction === "LONG"
        ? (exitPrice - candidate.entryPrice) / Math.abs(candidate.entryPrice - candidate.stopPrice)
        : (candidate.entryPrice - exitPrice) / Math.abs(candidate.entryPrice - candidate.stopPrice);
      const resolutionMethod = outcome === "WIN" ? "TARGET_HIT" : "STOP_HIT";
      const allocatedRisk = riskForCandidate(candidate);
      const challengeTrade = allocatedRisk != null
        ? (() => {
        const pnlKr = Math.round(allocatedRisk * realizedR);
          return {
            date: session.date,
            ticker: candidate.ticker.replace(/\.ST$/i, ""),
            strategy: `${candidate.category} (${candidate.signalSource ?? "okänd källa"})`,
            direction: candidate.direction,
            pnlKr,
            riskAllocationKr: allocatedRisk,
            flag: "LAST",
            followedPlan: true,
          };
        })()
        : undefined;
      const outcomeResponse = await fetch(api(`/candidates/${candidate.id}/outcome`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          exitPrice,
          resolutionMethod,
          challengeTrade,
        }),
      });
      if (!outcomeResponse.ok) {
        const body = await outcomeResponse.json().catch(() => ({}));
        throw new Error(body.error ?? "Kunde inte spara utfall och Challenge Tracker-trade.");
      }

      setLogging(null);
      setQuotes(prev => {
        const next = { ...prev };
        delete next[candidate.ticker];
        return next;
      });
      await load();
    } catch (error) {
      setOutcomeError(error instanceof Error ? error.message : "Kunde inte logga utfallet.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-xl mx-auto space-y-4 animate-pulse py-10">
        <div className="h-32 bg-muted rounded-xl" />
        <div className="h-48 bg-muted rounded-xl" />
        <div className="h-48 bg-muted rounded-xl" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto min-w-0 space-y-5 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Daglig briefing · Stockholm</p>
          <h2 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight">Dagens research</h2>
          <p className="mt-1 text-sm text-muted-foreground">Fryst urval, aktuella kandidater och registrerade utfall visas var för sig.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground">{todayISO()}</span>
          <Link href="/sessions/today" data-testid="nav-dagens-session-→" className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15">
            Senaste session <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>
      {sessionLoadError && <div role="alert" data-testid="status-session-load-error" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">{sessionLoadError}</div>
        <button type="button" onClick={() => void load()} data-testid="button-retry-session-load" className="shrink-0 font-medium underline underline-offset-2">Försök igen</button>
      </div>}
      <MarketIntelSection />
      <SwedishResearch latestReports={session?.sourceReports ?? []} />
      <details className="rounded-xl border border-border bg-card" data-testid="details-saved-top3">
        <summary className="cursor-pointer p-4 text-sm font-medium">Fullt sparat urval inklusive USA</summary>
        <div className="border-t border-border p-2 sm:p-3"><SavedTop3 /></div>
      </details>
      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer p-4 text-sm font-medium">Challenge · registrerat modellkonto och riskinställningar</summary>
      {/* ── Challenge Progress ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
            <Trophy className="w-3.5 h-3.5" />
            AG Challenge
          </div>
          <Link href="/survival" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
            Detaljer <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        {challengeLoadError && <p role="alert" data-testid="status-challenge-load-error" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {challengeLoadError}
        </p>}

        {account != null ? (
          <>
            <div className="mt-2 mb-3">
              <div className="text-3xl font-bold font-mono tracking-tight">{kr(account)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Mål: {kr(goalCapital)} · Trade {tradeCount}/100
                {account > startCapital && (
                  <span className="text-success ml-2">+{pct(((account - startCapital) / startCapital) * 100, 0)}</span>
                )}
              </div>
            </div>

            {/* Progress bar with milestones */}
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(1, goalPct)}%` }}
              />
            </div>

            {/* Milestone markers */}
            <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1 font-mono">
              {[startCapital, startCapital * 10, startCapital * 100, goalCapital].map((v) => (
                <span key={v} className={account >= v ? "text-success" : ""}>
                  {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : `${Math.round(v / 1000)}k`}
                </span>
              ))}
            </div>
          </>
        ) : challengeLoadError ? (
          <div className="text-sm text-muted-foreground mt-3">Challenge-konfigurationen kan inte verifieras just nu.</div>
        ) : (
          <div className="text-sm text-muted-foreground mt-3">
            Challenge Tracker ej konfigurerad.{" "}
            <Link href="/survival" className="text-primary underline">Sätt upp den här →</Link>
          </div>
        )}
      </div>

      {/* ── Total risk budget per direction ─────────────────────────────── */}
      {account != null && (
        <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
          <Target className="w-3.5 h-3.5 shrink-0" />
          <span>Total riskbudget per riktning:</span>
          {editingRisk ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="number"
                value={riskInput}
                onChange={e => setRiskInput(e.target.value)}
                onBlur={saveRisk}
                onKeyDown={e => e.key === "Enter" && saveRisk()}
                className="w-16 bg-muted border border-primary rounded px-2 py-0.5 text-xs text-right focus:outline-none"
              />
              <span>%</span>
            </div>
          ) : (
            <button onClick={() => { setRiskInput(String(riskPct)); setEditingRisk(true); }}
              className="flex items-center gap-1 font-mono font-bold text-foreground hover:text-primary transition-colors">
              {riskPct}%
              <Settings2 className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
          {riskKr != null && (
            <span className="ml-auto font-mono font-medium text-foreground">{kr(riskKr, 0)}</span>
          )}
        </div>
      )}

      </details>
      {/* ── Today's Picks ─────────────────────────────────────────────────── */}
      <details data-testid="details-session-workspace" className="rounded-xl border border-border bg-card p-3">
        <summary className="cursor-pointer text-sm font-medium">Sessionsarbetsyta<span className="ml-2 text-xs font-normal text-muted-foreground">ändringsbar research, USA, statistik-picks, diagnostik och utfallsloggning</span></summary>
        <div className="mt-3">
        <div className="flex items-center justify-between mb-3 px-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {session
                  ? `${sessionLabel(session.date)} · ${formatDate(session.date)}`
                  : "Ingen session"}
              </span>
              {session && !isToday && (
                <span data-testid="status-older-signal" className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded font-medium">
                  Äldre signal · väntar på ny
                </span>
              )}
            </div>
            {session && (
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>
                  {session.top3Revisions?.length
                    ? "Aktuell Top 3 uppdateras vid import · tidigare urval sparas"
                    : session.top3SelectionSnapshot?.available
                    ? `Fryst officiellt urval · ${session.top3SelectionSnapshot.policyVersion}`
                    : session.top3SelectionSnapshot?.state === "WAITING_FOR_SOURCES"
                      ? "Officiellt Top 3 låses direkt när båda dagens källor finns"
                    : session.top3SelectionSnapshot?.state === "WAITING_FOR_CUTOFF"
                      ? "Äldre policy · tidsstyrd låsning"
                      : session.top3SelectionSnapshot?.state === "MISSING_SOURCES"
                        ? "Officiellt Top 3 otillgängligt · källa saknades vid 16:30"
                        : "Officiellt Top 3-urval saknas"}
                </span>
                {(session.lastImportAt || session.createdAt) && (
                  <span className="opacity-60">
                    · {session.lastImportAt ? "importerad" : "skapad"} {new Date(session.lastImportAt || session.createdAt!).toLocaleString("sv-SE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {entryTickers.length > 0 && (
              <button
                onClick={fetchLivePrices}
                disabled={checkingPrices}
                title="Hämta live-priser från Yahoo Finance"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {checkingPrices
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Zap className="w-3.5 h-3.5" />}
                {checkingPrices ? "Kollar…" : "Kolla priser"}
              </button>
            )}
            {session && (
              <Link href={`/sessions/${session.id}`}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
                Alla <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>

        {session && <DailyCandidates
          picks={currentRevision?.picks ?? session.top3LiveSelection?.picks ?? []}
          signals={session.candidates} reports={session.sourceReports}
          sessionDate={session.date} preliminary={!currentRevision} />}
        {!!session?.top3Revisions?.length && (
          <CurrentTop3Selection revisions={session.top3Revisions} sessionId={session.id} quotes={quotes} candidates={session.candidates} />
        )}
        {session?.top3Revisions?.length && picks.length > 0 ? (
          <p className="mb-3 text-xs text-muted-foreground">Ursprungliga statistik-picks och registrerade trades visas nedan. Deras nivåer ändras inte av den aktuella listan ovan.</p>
        ) : null}
        {session && !isToday && picks.length > 0 && (
          <div data-testid="status-historical-picks" role="status" className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm mb-3 bg-amber-500/5 border border-amber-500/30 text-amber-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Förslagen nedan är från {formatDate(session.date)}, inte från i dag. De visas som historik medan en ny signal inväntas.
              Kontrollera ny signal och aktuella priser innan du överväger en trade.
            </span>
          </div>
        )}
        {picks.length === 0 && !loading && !(session && isToday && session.top3LiveSelection) && (
          <div className={`text-sm text-center py-12 border border-dashed rounded-xl ${
            session && !isToday
              ? "text-amber-600 border-amber-500/30 bg-amber-500/5"
              : "text-muted-foreground border-border"
          }`}>
            {session && !isToday
              ? !session.top3SelectionSnapshot?.available
                ? `Officiellt Top 3-urval saknas för äldre session ${session.date}; historiska picks räknas inte om eller återskapas.${edgeAiCandidates.length ? " Importerade EdgeAI-signaler visas separat nedan." : ""}`
                : `Senaste sessionen är från ${new Date(`${session.date}T12:00:00`).toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" })}. Inga signaler valdes som officiella picks i snapshoten. En ny signal kontrolleras automatiskt var 30:e sekund.`
              : session && !session.top3SelectionSnapshot?.available
                ? session.top3SelectionSnapshot?.unavailableReason ?? "Officiellt Top 3-urval saknas för den här sessionen."
              : session?.sessionReview?.status === "BLOCKED"
                ? "Ingen kvalificerad trade idag — signalerna stoppades av risk- och datakvalitetsregler."
                : "Inga picks idag ännu — kontrolleras automatiskt var 30:e sekund."}
          </div>
        )}
        {session && isToday && (
          <TodayDiagnostics
            sessionDate={session.date}
            today={todayISO()}
            candidates={allCandidates}
            live={session.top3LiveSelection}
            frozen={session.top3SelectionSnapshot}
          />
        )}
        {session && isToday && !session.top3Revisions?.length && session.top3LiveSelection && (
          <LiveTop3Preview
            live={session.top3LiveSelection}
            candidates={allCandidates}
            frozen={session.top3SelectionSnapshot}
            sessionId={session.id}
            quotes={quotes}
            onCutoff={load}
          />
        )}
        {session && edgeAiCandidates.length > 0 && (
          <div data-testid="edgeai-import-preview" className="mt-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Importerade EdgeAI-signaler · {edgeAiCandidates.length} st</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rapportdatum: {[...new Set(edgeAiCandidates.map((candidate) => candidate.signalDate).filter(Boolean))].join(", ") || "okänt"}. Inte officiellt Top 3.
                  {!isToday && " Äldre signaler – inte nya förslag för i dag."}
                </p>
              </div>
              <Link href={`/sessions/${session.id}`} className="shrink-0 text-xs text-primary hover:underline">
                Visa alla <ChevronRight className="inline h-3 w-3" />
              </Link>
            </div>
            <EdgeAiStatusTotals candidates={edgeAiCandidates} />
            <div className="mt-3 flex flex-wrap gap-2">
              {edgeAiCandidates.slice(0, 6).map(candidate => (
                <span key={candidate.id} title={candidate.decision?.reasons.join(" ") || undefined} className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
                  <span className="font-mono font-semibold">{candidate.ticker}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {candidate.market ?? "—"} · {candidate.direction === "SHORT" ? "Sälj" : "Köp"}
                  </span>
                  <span className="ml-1.5"><DecisionBadge decision={candidate.decision} /></span>
                </span>
              ))}
              {edgeAiCandidates.length > 6 && (
                <span className="self-center text-xs text-muted-foreground">+{edgeAiCandidates.length - 6} till</span>
              )}
            </div>
          </div>
        )}
        {session?.sessionReview && isToday && session.sessionReview.reasons.length > 0 && (
          <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm mb-3 ${
            session.sessionReview.status === "BLOCKED"
              ? "bg-destructive/10 border border-destructive/20 text-destructive"
              : "bg-amber-500/10 border border-amber-500/20 text-amber-500"
          }`}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">{session.sessionReview.status === "BLOCKED" ? "No-trade" : "Kontroll före trade"}</span>
              <p className="text-xs mt-0.5 opacity-90">{session.sessionReview.reasons.join(" ")}</p>
            </div>
          </div>
        )}
        {outcomeError && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm mb-3 bg-destructive/10 border border-destructive/20 text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{outcomeError}</p>
          </div>
        )}

        {/* ── Regime filter warning ─────────────────────────────────────── */}
        {picks.length > 0 && (isRiskOff || isRsiHigh || isRsiLow) && (
          <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm mb-1 ${
            isRiskOff
              ? "bg-destructive/10 border border-destructive/20 text-destructive"
              : "bg-amber-500/10 border border-amber-500/20 text-amber-500"
          }`}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {isRiskOff
                ? `Marknaden signalerar ${mw?.trendLabel} — överväg att sitta still eller ta halv position.`
                : isRsiHigh
                ? `OMXS30 RSI ${mw?.rsi} — extremt overbought. Momentum kan reversera snart.`
                : `OMXS30 RSI ${mw?.rsi} — extremt oversold. Hög volatilitet, var extra försiktig med storlek.`}
            </span>
          </div>
        )}

        <div className="space-y-3">
          {picks.map((candidate, i) => {
            const prevMarket = i > 0 ? picks[i - 1].market : null;
            const showHeader = hasMarket && candidate.market !== prevMarket;
            const prevDir = i > 0 ? picks[i - 1].direction : null;
            const isFirstLong = candidate.direction !== "SHORT" && i === 0;
            const isFirstShort = candidate.direction === "SHORT" && prevDir !== "SHORT";
            const isLong = candidate.direction === "LONG";
            const stopDist = ((candidate.entryPrice - candidate.stopPrice) / candidate.entryPrice) * 100 * (isLong ? 1 : -1);
            const targetDist = ((candidate.targetPrice - candidate.entryPrice) / candidate.entryPrice) * 100 * (isLong ? 1 : -1);
            const isDone = candidate.outcome && candidate.outcome !== "PENDING";
            const isLogging = logging === candidate.id;
            const allocatedRisk = riskForCandidate(candidate);
            const winPnl = allocatedRisk != null ? Math.round(allocatedRisk * candidate.rr) : null;
            const lossPnl = allocatedRisk != null ? Math.round(-allocatedRisk) : null;
            const quote = quotes[candidate.ticker];
            const autoHit = isToday && !isDone ? autoDetectOutcome(candidate) : null;
            const edgeMetrics = edgeAiMetrics(candidate);

            // price bar: where live price sits between stop and target
            const priceBarPct = quote?.livePrice != null ? (() => {
              const range = Math.abs(candidate.targetPrice - candidate.stopPrice);
              if (range === 0) return 50;
              const pos = isLong
                ? (quote.livePrice! - candidate.stopPrice) / range
                : (candidate.stopPrice - quote.livePrice!) / range;
              return Math.max(0, Math.min(100, pos * 100));
            })() : null;

            return (
              <div key={candidate.id}>
                {isFirstLong && (
                  <div className="flex items-center gap-2 px-1 pt-1 pb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-success" />
                    <span className="text-sm font-semibold text-success">Topp 3 Köp</span>
                    <span className="text-[10px] text-muted-foreground">fryst vid signalen</span>
                  </div>
                )}
                {showHeader && (
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-2 pb-2 flex items-center gap-1.5">
                    {candidate.market === "SE" ? "🇸🇪 Sverige" : "🇺🇸 USA"}
                  </div>
                )}
                {isFirstShort && (
                  <div className="flex items-center gap-2 px-1 pt-4 pb-2 border-t border-destructive/20 mt-2">
                    <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                    <span className="text-sm font-semibold text-destructive">Topp 3 Sälj</span>
                    {isRiskOff && (
                      <span className="text-[10px] bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 rounded font-medium">
                        risk-off
                      </span>
                    )}
                  </div>
                )}
              <div
                className={`bg-card border rounded-xl shadow-sm overflow-hidden transition-all ${
                  autoHit === "WIN"
                    ? "border-success ring-1 ring-success/30"
                    : autoHit === "LOSS"
                    ? "border-destructive ring-1 ring-destructive/30"
                    : isDone
                    ? candidate.outcome === "WIN"
                      ? "border-success/40 opacity-70"
                      : candidate.outcome === "LOSS"
                      ? "border-destructive/40 opacity-70"
                      : "border-border opacity-50"
                    : "border-border"
                }`}
              >
                {/* Card header */}
                <div className={`px-5 pt-4 pb-3 flex items-start justify-between ${isLong ? "border-l-4 border-l-success" : "border-l-4 border-l-destructive"}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xl tracking-tight">
                        {candidate.ticker.replace(/\.ST$/i, "")}
                      </span>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                        isLong
                          ? "bg-success/10 text-success border border-success/20"
                          : "bg-destructive/10 text-destructive border border-destructive/20"
                      }`}>
                        {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {candidate.direction}
                      </span>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-400/10 text-amber-500 border border-amber-400/20">
                        <Star className="w-3 h-3 fill-amber-400" />
                        {candidate.isTop3Pick ? "Stjärna · anteckning" : "Officiellt Top 3"}
                      </span>
                      {isDone && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          candidate.outcome === "WIN" ? "text-success" : "text-destructive"
                        }`}>
                          {candidate.outcome === "WIN" ? "✓ VANN" : candidate.outcome === "LOSS" ? "✗ FÖRLORADE" : candidate.outcome}
                        </span>
                      )}
                      {/* Live price badge */}
                      {quote?.livePrice != null && !isDone && (
                        <span
                          className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                            autoHit === "WIN" ? "bg-success text-success-foreground"
                            : autoHit === "LOSS" ? "bg-destructive text-destructive-foreground"
                            : "bg-muted text-muted-foreground"
                          }`}
                          title={quote.asOf ? `Kursen är från kl ${new Date(quote.asOf).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : undefined}
                        >
                          {formatPrice(quote.livePrice)}
                          {quote.changePct != null && (
                            <span className="ml-1 opacity-70">{pct(quote.changePct)}</span>
                          )}
                          {timeAgo(quote.asOf) && (
                            <span className="ml-1 opacity-60 font-normal">· {timeAgo(quote.asOf)}</span>
                          )}
                        </span>
                      )}
                    </div>
                    <LiveEntryGuard plan={candidate} quote={quote} signal={candidate} />
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                      <span>Pick #{i + 1} · R:R {formatRR(candidate.rr)}</span>
                      {edgeMetrics.isEdgeAI && (
                        <span data-testid={`edgeai-metrics-${candidate.id}`}>
                          EdgeAI · WR {edgeMetrics.winRate == null ? "okänd" : `${Math.round(edgeMetrics.winRate * 100)}%`}
                          {" · E[R] "}{edgeMetrics.expectancyR == null ? "okänd" : `${edgeMetrics.expectancyR >= 0 ? "+" : ""}${edgeMetrics.expectancyR.toFixed(2)}R`}
                          {" · N "}{edgeMetrics.sampleN == null ? "okänd" : Math.round(edgeMetrics.sampleN)}
                          {" · ålder "}{edgeMetrics.signalAgeBars == null ? "okänd" : `${edgeMetrics.signalAgeBars} bars`}
                          {" · max "}{edgeMetrics.maxHoldDays == null ? "okänd" : `${edgeMetrics.maxHoldDays} dagar`}
                        </span>
                      )}
                      <span>Volym {candidate.volMultiplier > 0
                        ? `${candidate.volMultiplier.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x · stängd ${candidate.volumeAsOf || "datum saknas"}${candidate.volumeAsOf && candidate.signalDate && candidate.volumeAsOf < candidate.signalDate ? " (före signal)" : ""}`
                        : "saknas"}</span>
                      {candidate.review?.status === "WARN" && <span className="text-amber-500">⚠ granska</span>}
                    </div>
                  </div>

                  {candidate.review && candidate.review.reasons.length > 0 && (
                    <div className={`rounded-lg px-3 py-2 text-xs ${
                      candidate.review.status === "BLOCKED"
                        ? "bg-destructive/10 border border-destructive/20 text-destructive"
                        : "bg-amber-500/10 border border-amber-500/20 text-amber-500"
                    }`}>
                      <strong>{candidate.review.status === "BLOCKED" ? "Ej kvalificerad: " : "Kontroll: "}</strong>
                      {candidate.review.reasons.join(" ")}
                    </div>
                  )}
                </div>

                {/* Levels */}
                <div className="px-5 pb-4 space-y-2">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Entry</div>
                      <div className="font-mono font-bold">{formatPrice(candidate.entryPrice)}</div>
                    </div>
                    <div className="bg-destructive/5 border border-destructive/15 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-destructive/80 uppercase tracking-wider mb-1">Stop</div>
                      <div className="font-mono font-bold text-destructive">{formatPrice(candidate.stopPrice)}</div>
                      <div className="text-[10px] text-destructive/60">{pct(-Math.abs(stopDist))}</div>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${candidate.targetPrice > 0 && Math.abs(targetDist) > 10 ? "bg-amber-500/5 border border-amber-500/20" : "bg-success/5 border border-success/15"}`}>
                      <div className="text-[10px] text-success/80 uppercase tracking-wider mb-1">Target</div>
                      <div className="font-mono font-bold text-success">{formatPrice(candidate.targetPrice)}</div>
                      <div className={`text-[10px] font-medium ${candidate.targetPrice > 0 && Math.abs(targetDist) > 10 ? "text-amber-500" : "text-success/60"}`}>
                        +{Math.abs(targetDist).toFixed(1)}%{candidate.targetPrice > 0 && Math.abs(targetDist) > 10 ? " ⚠" : ""}
                      </div>
                    </div>
                  </div>

                  {/* Price position bar: stop ←——●——→ target */}
                  {priceBarPct != null && !isDone && (
                    <div className="space-y-0.5">
                      <div className="relative h-2 rounded-full overflow-hidden" style={{
                        background: "linear-gradient(to right, var(--destructive) 0%, var(--muted) 30%, var(--muted) 70%, var(--success) 100%)"
                      }}>
                        <div
                          className="absolute top-0 w-2 h-2 rounded-full bg-white border-2 border-foreground shadow"
                          style={{ left: `calc(${priceBarPct}% - 4px)` }}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground/50 font-mono">
                        <span>stop</span>
                        <span>target</span>
                      </div>
                    </div>
                  )}

                  {/* P&L estimate */}
                  {isToday && riskKr != null && !isDone && (
                    <div className="flex gap-2 text-xs font-mono text-muted-foreground">
                      <span>Win: <strong className="text-success">+{kr(winPnl!)}</strong></span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>Loss: <strong className="text-destructive">{kr(lossPnl!)}</strong></span>
                      {picks.filter((pick) => pick.direction === candidate.direction).length > 1 && (
                        <span className="text-amber-500">· delad riktningrisk</span>
                      )}
                    </div>
                  )}

                  {/* Auto-hit banner */}
                  {autoHit && !isDone && (
                    <div className={`rounded-lg px-4 py-3 flex items-center justify-between ${
                      autoHit === "WIN"
                        ? "bg-success/10 border border-success/30"
                        : "bg-destructive/10 border border-destructive/30"
                    }`}>
                      <div className={`text-sm font-bold ${autoHit === "WIN" ? "text-success" : "text-destructive"}`}>
                        {autoHit === "WIN" ? "🎯 Target nådd!" : "🛑 Stop nådd!"}
                        <span className="font-normal text-xs ml-2 opacity-70">live-pris: {quote?.livePrice?.toFixed(2)}</span>
                      </div>
                      <button
                        disabled={submitting}
                        onClick={() => logOutcome(candidate, autoHit)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors disabled:opacity-50 ${
                          autoHit === "WIN"
                            ? "bg-success text-success-foreground hover:bg-success/90"
                            : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        }`}
                      >
                        {submitting ? "…" : `Logga ${autoHit === "WIN" ? `VANN${winPnl != null ? ` +${kr(winPnl)}` : ""}` : `FÖRLORADE${lossPnl != null ? ` ${kr(lossPnl)}` : ""}`}`}
                      </button>
                    </div>
                  )}

                  {/* Manual action buttons */}
                  {isToday && !isDone && !autoHit && (
                    <div className="pt-1">
                      {isLogging ? (
                        <div className="flex gap-2">
                          <button
                            disabled={submitting}
                            onClick={() => logOutcome(candidate, "WIN")}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-success text-success-foreground font-bold text-sm hover:bg-success/90 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {submitting ? "…" : `VANN${winPnl != null ? ` +${kr(winPnl)}` : ""}`}
                          </button>
                          <button
                            disabled={submitting}
                            onClick={() => logOutcome(candidate, "LOSS")}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-bold text-sm hover:bg-destructive/90 transition-colors disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            {submitting ? "…" : `FÖRLORADE${lossPnl != null ? ` ${kr(lossPnl)}` : ""}`}
                          </button>
                          <button onClick={() => setLogging(null)}
                            className="px-3 py-2.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors text-sm">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setLogging(candidate.id)}
                          className="w-full py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          Logga utfall →
                        </button>
                      )}
                    </div>
                  )}

                  {/* Still show manual button after auto-hit (override) */}
                  {isToday && !isDone && autoHit && (
                    <div className="pt-1">
                      {isLogging ? (
                        <div className="flex gap-2">
                          <button disabled={submitting} onClick={() => logOutcome(candidate, "WIN")}
                            className="flex-1 py-2 rounded-lg bg-success text-success-foreground font-bold text-xs hover:bg-success/90 disabled:opacity-50">
                            VANN
                          </button>
                          <button disabled={submitting} onClick={() => logOutcome(candidate, "LOSS")}
                            className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground font-bold text-xs hover:bg-destructive/90 disabled:opacity-50">
                            FÖRLORADE
                          </button>
                          <button onClick={() => setLogging(null)}
                            className="px-3 py-2 rounded-lg border border-border text-muted-foreground text-xs hover:bg-muted">✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setLogging(candidate.id)}
                          className="w-full py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors">
                          Logga manuellt →
                        </button>
                      )}
                    </div>
                  )}
                  {!isToday && !isDone && session && (
                    <Link
                      href={`/sessions/${session.id}`}
                      data-testid={`link-historical-outcome-${candidate.id}`}
                      className="block w-full py-2.5 rounded-lg border border-border text-center text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Se session och logga faktiskt utfall →
                    </Link>
                  )}
                </div>
              </div>
              </div>
            );
          })}
        </div>
        </div>
      </details>

      {/* ── No session state ──────────────────────────────────────────────── */}
      {!session && !loading && (
        <div className="text-center py-8 text-muted-foreground space-y-2">
          <div className="text-sm">Ingen session importerad ännu.</div>
          <Link href="/import" className="text-xs text-primary hover:underline">Importera data →</Link>
        </div>
      )}
    </div>
  );
}
