/**
 * Idag — daglig briefing + challenge-tracker i ett
 *
 * Flöde:
 *  1. Hämta senaste screener-session → visa top 3 picks med entry/stop/target
 *  2. Hämta challenge-tracker → visa kontobalans & framsteg mot målet
 *  3. Klicka VANN / FÖRLORADE per pick → loggar till challenge + markerar utfall
 *  4. "Kolla priser" → hämtar live-priser via Yahoo Finance, auto-föreslår utfall
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Trophy, ChevronRight,
  Target, Settings2, CheckCircle2, XCircle, RefreshCw, Zap, AlertTriangle,
} from "lucide-react";

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
  return new Date().toLocaleDateString("sv-SE"); // "YYYY-MM-DD" in sv-SE locale
}

function sessionLabel(date: string): string {
  const today = todayISO();
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE");
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
  isTop3Pick: boolean;
  perf1m: number;
  rsi: number;
  outcome: string;
  earningsInDays: number | null;
  market: "SE" | "US" | null;
  pctB: number; // EdgeAI sample size (number of historical observations)
};

type Session = {
  id: number;
  date: string;
  source: string | null;
  createdAt: string | null;
  marketWeather: {
    omxsValue: number;
    perf5d: number;
    perf1m: number;
    perf3m: number;
    rsi: number;
    trendLabel: string;
  } | null;
  candidates: Candidate[];
};

type ChallengeData = {
  config: { startCapital: number; goalCapital: number; currentCapital: number | null; riskPct: number };
  stats: { equity: number; totalTrades: number; wins: number; losses: number };
};

type LiveQuote = {
  livePrice: number | null;
  changePct: number | null;
  error: string | null;
};

// ── main ─────────────────────────────────────────────────────────────────────

export function Today() {
  const [session, setSession] = useState<Session | null>(null);
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [loading, setLoading] = useState(true);

  // per-trade logging state
  const [logging, setLogging] = useState<number | null>(null); // candidate id
  const [submitting, setSubmitting] = useState(false);

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
      setRiskPct(v);
      await fetch(api("/survival/config"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskPct: v }),
      });
    }
    setEditingRisk(false);
  };

  const load = async () => {
    try {
      const [sessionsRes, challengeRes] = await Promise.all([
        fetch(api("/screener/sessions")).then(r => r.ok ? r.json() : []),
        fetch(api("/survival")).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (Array.isArray(sessionsRes) && sessionsRes.length > 0) {
        const latest = sessionsRes[0];
        const detail = await fetch(api(`/screener/sessions/${latest.id}`)).then(r => r.json());
        setSession(detail);
      }

      if (challengeRes) {
        setChallenge(challengeRes);
        const serverRisk = challengeRes.config?.riskPct;
        if (typeof serverRisk === "number" && serverRisk > 0) {
          setRiskPct(serverRisk);
          setRiskInput(String(serverRisk));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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

  // top picks: prefer starred, fallback to edge-score rank — split by market if data exists
  function selectPicks(cands: Candidate[], n = 3): Candidate[] {
    const starred = cands.filter(c => c.isTop3Pick);
    if (starred.length > 0) return starred.slice(0, n);
    return [...cands].sort((a, b) => b.perf1m * b.rsi - a.perf1m * a.rsi).slice(0, n);
  }

  const allCandidates = session?.candidates ?? [];
  const hasMarket = allCandidates.some(c => c.market != null);
  const sePicks = hasMarket ? selectPicks(allCandidates.filter(c => c.market === "SE")) : [];
  const usPicks = hasMarket ? selectPicks(allCandidates.filter(c => c.market === "US")) : [];
  // flat array for rendering: SE first, then US; legacy fallback if no market data
  const picks: Candidate[] = hasMarket ? [...sePicks, ...usPicks] : selectPicks(allCandidates);

  // risk amounts per pick
  const riskKr = account != null ? account * (riskPct / 100) : null;

  // ── Yahoo Finance price check ─────────────────────────────────────────────

  const fetchLivePrices = async () => {
    if (picks.length === 0 || checkingPrices) return;
    setCheckingPrices(true);
    try {
      const tickers = picks.map(p => p.ticker).join(",");
      const res = await fetch(api(`/screener/quotes?tickers=${encodeURIComponent(tickers)}`));
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, LiveQuote> = {};
      for (const q of data) {
        map[q.ticker] = { livePrice: q.livePrice, changePct: q.changePct, error: q.error };
      }
      setQuotes(map);
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
    try {
      // 1. Mark screener candidate outcome
      await fetch(api(`/screener/candidates/${candidate.id}/outcome`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, exitPrice: outcome === "WIN" ? candidate.targetPrice : candidate.stopPrice }),
      });

      // 2. Log to challenge tracker with auto-calculated P&L
      if (riskKr != null) {
        const pnlKr = outcome === "WIN"
          ? Math.round(riskKr * candidate.rr)
          : Math.round(-riskKr);
        await fetch(api("/survival/trades"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: session.date,
            ticker: candidate.ticker.replace(/\.ST$/i, ""),
            strategy: "trend pullback",
            direction: candidate.direction,
            pnlKr,
            flag: "LAST",
            followedPlan: true,
          }),
        });
      }

      setLogging(null);
      setQuotes(prev => {
        const next = { ...prev };
        delete next[candidate.ticker];
        return next;
      });
      await load();
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

  const isToday = session?.date === todayISO();

  return (
    <div className="max-w-xl mx-auto space-y-5 pb-16">

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
        ) : (
          <div className="text-sm text-muted-foreground mt-3">
            Challenge Tracker ej konfigurerad.{" "}
            <Link href="/survival" className="text-primary underline">Sätt upp den här →</Link>
          </div>
        )}
      </div>

      {/* ── Risk per trade ────────────────────────────────────────────────── */}
      {account != null && (
        <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
          <Target className="w-3.5 h-3.5 shrink-0" />
          <span>Risk per trade:</span>
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

      {/* ── Today's Picks ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {session
                  ? `${sessionLabel(session.date)} · ${formatDate(session.date)}`
                  : "Ingen session"}
              </span>
              {session && !isToday && (
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-medium">
                  Väntar på ny signal
                </span>
              )}
            </div>
            {session && (
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>{picks.some(p => p.isTop3Pick) ? "Dina ⭐ val" : "Auto-rank (topp 3 edge-score)"}</span>
                {session.createdAt && (
                  <span className="opacity-60">
                    · importerad {new Date(session.createdAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {picks.length > 0 && picks.some(p => p.outcome === "PENDING" || !p.outcome) && (
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

        {picks.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground text-center py-12 border border-dashed border-border rounded-xl">
            Inga picks idag ännu — kontrolleras automatiskt var 5:e minut från kl 10:00.
          </div>
        )}

        {/* ── Regime filter warning ─────────────────────────────────────── */}
        {picks.length > 0 && session?.marketWeather && (() => {
          const { trendLabel, rsi } = session.marketWeather!;
          const isRiskOff = /risk.?off|motvind|kontrak/i.test(trendLabel ?? "");
          const isRsiHigh = rsi > 0 && rsi > 75;
          const isRsiLow  = rsi > 0 && rsi < 25;
          if (!isRiskOff && !isRsiHigh && !isRsiLow) return null;
          return (
            <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm mb-1 ${
              isRiskOff
                ? "bg-destructive/10 border border-destructive/20 text-destructive"
                : "bg-amber-500/10 border border-amber-500/20 text-amber-500"
            }`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {isRiskOff
                  ? `Marknaden signalerar ${trendLabel} — överväg att sitta still eller ta halv position.`
                  : isRsiHigh
                  ? `OMXS30 RSI ${rsi} — extremt overbought. Momentum kan reversera snart.`
                  : `OMXS30 RSI ${rsi} — extremt oversold. Hög volatilitet, var extra försiktig med storlek.`}
              </span>
            </div>
          );
        })()}

        <div className="space-y-3">
          {picks.map((candidate, i) => {
            const prevMarket = i > 0 ? picks[i - 1].market : null;
            const showHeader = hasMarket && candidate.market !== prevMarket;
            const isLong = candidate.direction === "LONG";
            const stopDist = ((candidate.entryPrice - candidate.stopPrice) / candidate.entryPrice) * 100 * (isLong ? 1 : -1);
            const targetDist = ((candidate.targetPrice - candidate.entryPrice) / candidate.entryPrice) * 100 * (isLong ? 1 : -1);
            const isDone = candidate.outcome && candidate.outcome !== "PENDING";
            const isLogging = logging === candidate.id;
            const winPnl = riskKr != null ? Math.round(riskKr * candidate.rr) : null;
            const lossPnl = riskKr != null ? Math.round(-riskKr) : null;
            const quote = quotes[candidate.ticker];
            const autoHit = !isDone ? autoDetectOutcome(candidate) : null;

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
                {showHeader && (
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-2 pb-2 flex items-center gap-1.5">
                    {candidate.market === "SE" ? "🇸🇪 Sverige" : "🇺🇸 USA"}
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
                      {isDone && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          candidate.outcome === "WIN" ? "text-success" : "text-destructive"
                        }`}>
                          {candidate.outcome === "WIN" ? "✓ VANN" : candidate.outcome === "LOSS" ? "✗ FÖRLORADE" : candidate.outcome}
                        </span>
                      )}
                      {/* Live price badge */}
                      {quote?.livePrice != null && !isDone && (
                        <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                          autoHit === "WIN" ? "bg-success text-success-foreground"
                          : autoHit === "LOSS" ? "bg-destructive text-destructive-foreground"
                          : "bg-muted text-muted-foreground"
                        }`}>
                          {quote.livePrice.toFixed(2)}
                          {quote.changePct != null && (
                            <span className="ml-1 opacity-70">{pct(quote.changePct)}</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                      <span>Pick #{i + 1} · R:R {candidate.rr.toFixed(1)}</span>
                      {candidate.perf1m > 0 && <span>WR {(candidate.perf1m * 100).toFixed(0)}%</span>}
                      {candidate.rsi > 0 && <span>E {(candidate.rsi / 100).toFixed(2)}R</span>}
                      {candidate.pctB > 0 && <span>{Math.round(candidate.pctB)} obs</span>}
                    </div>
                  </div>
                </div>

                {/* Levels */}
                <div className="px-5 pb-4 space-y-2">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Entry</div>
                      <div className="font-mono font-bold">{candidate.entryPrice.toFixed(2)}</div>
                    </div>
                    <div className="bg-destructive/5 border border-destructive/15 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-destructive/80 uppercase tracking-wider mb-1">Stop</div>
                      <div className="font-mono font-bold text-destructive">{candidate.stopPrice.toFixed(2)}</div>
                      <div className="text-[10px] text-destructive/60">{pct(-Math.abs(stopDist))}</div>
                    </div>
                    <div className="bg-success/5 border border-success/15 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-success/80 uppercase tracking-wider mb-1">Target</div>
                      <div className="font-mono font-bold text-success">{candidate.targetPrice.toFixed(2)}</div>
                      <div className="text-[10px] text-success/60">+{Math.abs(targetDist).toFixed(1)}%</div>
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
                  {riskKr != null && !isDone && (
                    <div className="flex gap-2 text-xs font-mono text-muted-foreground">
                      <span>Win: <strong className="text-success">+{kr(winPnl!)}</strong></span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>Loss: <strong className="text-destructive">{kr(lossPnl!)}</strong></span>
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
                  {!isDone && !autoHit && (
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
                  {!isDone && autoHit && (
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
                </div>
              </div>
              </div>
            );
          })}
        </div>
      </div>

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
