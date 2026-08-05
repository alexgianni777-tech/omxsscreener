import { useState, useEffect, useRef } from "react";
import {
  ShieldAlert, TrendingUp, TrendingDown, Plus, Trash2,
  BookOpen, Zap, Target, AlertTriangle, Trophy,
} from "lucide-react";

// ─── types ──────────────────────────────────────────────────────────────────

type SurvivalTrade = {
  id: number;
  date: string;
  ticker: string | null;
  strategy: string;
  direction: "LONG" | "SHORT";
  leverageX: number | null;
  pnlKr: number;
  flag: "LAST" | "REFLEX";
  followedPlan: boolean;
  createdAt: string;
};

type Stats = {
  equity: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winPct: number | null;
  currentStreak: number;
  maxStreak: number;
  circuitBreakerActive: boolean;
  disciplinePct: number | null;
  last: { n: number; sum: number; avg: number; winPct: number } | null;
  reflex: { n: number; sum: number; avg: number; winPct: number } | null;
  equityCurve: { i: number; eq: number }[];
};

type SurvivalData = {
  config: { id: number; startCapital: number; goalCapital: number };
  trades: SurvivalTrade[];
  stats: Stats;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}/api${path}`;

function sgn(n: number, decimals = 0) {
  const s = Math.abs(n).toLocaleString("sv-SE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n >= 0 ? "+" : "−") + s;
}

function fmt(n: number) {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─── equity curve SVG ────────────────────────────────────────────────────────

function EquityCurve({ points, start }: { points: { i: number; eq: number }[]; start: number }) {
  if (points.length < 2) return (
    <div className="h-28 flex items-center justify-center text-xs text-muted-foreground font-mono">
      Kurvan byggs från första trade
    </div>
  );

  const W = 600, H = 100;
  const xs = points.map((p) => p.i);
  const ys = points.map((p) => p.eq);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;
  const maxX = xs[xs.length - 1] || 1;

  const px = (i: number) => (i / maxX) * W;
  const py = (eq: number) => H - ((eq - minY) / rangeY) * H * 0.85 - H * 0.075;

  const polyline = points.map((p) => `${px(p.i)},${py(p.eq)}`).join(" ");
  const startY = py(start);
  const lastEq = ys[ys.length - 1];
  const isUp = lastEq >= start;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
      <line x1="0" y1={startY} x2={W} y2={startY} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 4" />
      <polyline
        points={polyline}
        fill="none"
        stroke={isUp ? "#3FB950" : "#F85149"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── milestone ladder ────────────────────────────────────────────────────────

function Ladder({ start, goal, equity }: { start: number; goal: number; equity: number }) {
  const rungs: number[] = [];
  let r = start * 2;
  while (r < goal && rungs.length < 8) { rungs.push(r); r *= 2; }
  rungs.push(goal);
  let nextMarked = false;

  return (
    <div className="space-y-2">
      {rungs.map((v) => {
        const done = equity >= v;
        const pct = Math.max(0, Math.min(1, equity / v));
        const isNext = !done && !nextMarked;
        if (isNext) nextMarked = true;
        const label = v >= 1_000_000
          ? `${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
          : `${Math.round(v / 1000)}k`;
        return (
          <div key={v} className={`flex items-center gap-3 ${isNext ? "opacity-100" : done ? "opacity-60" : "opacity-30"}`}>
            <span className={`w-4 text-xs font-mono ${done ? "text-emerald-400" : isNext ? "text-amber-400" : "text-muted-foreground"}`}>
              {done ? "✓" : "·"}
            </span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : isNext ? "bg-amber-400" : "bg-muted-foreground/30"}`}
                style={{ width: `${(pct * 100).toFixed(1)}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs font-mono text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export function Survival() {
  const [data, setData] = useState<SurvivalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [flag, setFlag] = useState<"LAST" | "REFLEX" | null>(null);
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(null);
  const [ticker, setTicker] = useState("");
  const [strategy, setStrategy] = useState("trend pullback");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [leverageX, setLeverageX] = useState("");
  const [pnlKr, setPnlKr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // config editing
  const [editStart, setEditStart] = useState("");
  const [editGoal, setEditGoal] = useState("");

  const load = async () => {
    try {
      const r = await fetch(api("/survival"));
      if (!r.ok) throw new Error(`${r.status}`);
      const d: SurvivalData = await r.json();
      setData(d);
      setEditStart(String(d.config.startCapital));
      setEditGoal(String(d.config.goalCapital));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    await fetch(api("/survival/config"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startCapital: Number(editStart) || undefined,
        goalCapital: Math.max(Number(editGoal) || 0, (Number(editStart) || 0) * 2) || undefined,
      }),
    });
    load();
  };

  const addTrade = async () => {
    if (!flag || followedPlan === null || pnlKr === "" || !strategy) return;
    setSubmitting(true);
    try {
      await fetch(api("/survival/trades"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: today(),
          ticker: ticker.trim().toUpperCase() || undefined,
          strategy,
          direction,
          leverageX: Number(leverageX) || undefined,
          pnlKr: Number(pnlKr),
          flag,
          followedPlan,
        }),
      });
      setTicker(""); setPnlKr(""); setLeverageX("");
      setFlag(null); setFollowedPlan(null);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTrade = async (id: number) => {
    if (!window.confirm("Ta bort den här traden?")) return;
    try {
      await fetch(api(`/survival/trades/${id}`), { method: "DELETE" });
    } catch { /* ignore network errors — reload will show current state */ }
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm animate-pulse">
      Laddar Survival Challenge…
    </div>
  );
  if (error || !data) return (
    <div className="p-6 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
      {error ?? "Okänt fel"}
    </div>
  );

  const { config, trades, stats } = data;
  const delta = stats.equity - config.startCapital;
  // Allow pnlKr = "0" (break-even) — only block truly empty string
  const canAdd = flag !== null && followedPlan !== null && pnlKr !== "" && strategy !== "" && isFinite(Number(pnlKr));

  // Läst vs Reflex verdict
  let verdict = "";
  if (stats.last && stats.reflex && stats.last.n >= 3 && stats.reflex.n >= 3) {
    const gap = stats.last.avg - stats.reflex.avg;
    verdict = gap > 0
      ? `Dina <b>lästa</b> trades slår reflex med <b>${sgn(gap, 0)} kr/trade</b>. Varje reflex-entry du hoppar över är i snitt värd det.`
      : `Just nu går reflex bättre — men på n=${stats.reflex.n} är det brus, inte bevis. Edgen byggs i det lästa.`;
  } else if (trades.length) {
    verdict = "Splitten blir meningsfull från ~3 trades per kategori. Flagga ärligt — mätaren är bara så bra som din ärlighet.";
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-amber-400" />
            Survival Challenge
          </h2>
          <p className="text-muted-foreground text-sm mt-1 font-mono">
            Läst vs reflex · circuit breaker · milestone ladder
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Kapital</div>
          <div className={`font-mono text-3xl font-semibold ${stats.equity >= config.startCapital ? "text-emerald-400" : "text-red-400"}`}>
            {fmt(stats.equity)} kr
          </div>
          {trades.length > 0 && (
            <div className={`font-mono text-xs mt-1 ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {sgn(delta)} · {delta >= 0 ? "+" : ""}{config.startCapital ? ((delta / config.startCapital) * 100).toFixed(1) : 0}%
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 justify-end">
            <span className="text-xs text-muted-foreground">Start</span>
            <input
              type="number"
              value={editStart}
              onChange={(e) => setEditStart(e.target.value)}
              onBlur={saveConfig}
              className="w-20 bg-muted border border-border text-right font-mono text-xs px-2 py-1 rounded-md"
            />
            <span className="text-xs text-muted-foreground">Mål</span>
            <input
              type="number"
              value={editGoal}
              onChange={(e) => setEditGoal(e.target.value)}
              onBlur={saveConfig}
              className="w-24 bg-muted border border-border text-right font-mono text-xs px-2 py-1 rounded-md"
            />
          </div>
        </div>
      </header>

      {/* ── Circuit Breaker ── */}
      {stats.circuitBreakerActive && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/5 space-y-1">
          <div className="font-semibold text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Circuit Breaker — STOPP
          </div>
          <p className="text-sm text-muted-foreground">
            Stanna. Ingen ny trade idag. {stats.currentStreak} förluster i rad —
            matematiken säger paus, inte känslan. Kom tillbaka imorgon med en läst setup.
          </p>
        </div>
      )}

      {/* ── Streak Warning (2 losses — one away from circuit breaker) ── */}
      {!stats.circuitBreakerActive && stats.currentStreak === 2 && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-1">
          <div className="font-semibold text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Varning — 2 förluster i rad
          </div>
          <p className="text-sm text-muted-foreground">
            En till och circuit breakern slår till. Nästa trade: bara om den är 100% läst. Ingen reflex.
          </p>
        </div>
      )}

      {/* ── Equity Curve ── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Kapitalutveckling</h3>
        <EquityCurve points={stats.equityCurve} start={config.startCapital} />
      </div>

      {/* ── Stats tiles ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Trades", value: stats.totalTrades, sub: `${stats.wins}W · ${stats.losses}L` },
          { label: "Win %", value: stats.winPct != null ? `${stats.winPct}%` : "—", sub: "alla trades" },
          { label: "Max svit", value: stats.maxStreak, sub: `nu: ${stats.currentStreak}` },
          { label: "Disciplin", value: stats.disciplinePct != null ? `${stats.disciplinePct}%` : "—", sub: "följde plan" },
          { label: "P&L", value: `${sgn(delta)} kr`, sub: delta >= 0 ? "vinst" : "förlust" },
          { label: "Mål", value: config.goalCapital >= 1_000_000 ? `${(config.goalCapital / 1_000_000).toFixed(0)}M` : `${Math.round(config.goalCapital / 1000)}k`, sub: "slutmål" },
        ].map((t) => (
          <div key={t.label} className="bg-card border border-border rounded-xl p-3">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{t.label}</div>
            <div className="font-mono text-lg font-semibold mt-1">{t.value}</div>
            <div className="text-xs text-muted-foreground font-mono">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Läst vs Reflex split ── */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "📖 Läst", color: "border-emerald-500/30 bg-emerald-500/5", stat: stats.last },
          { label: "⚡ Reflex", color: "border-amber-500/30 bg-amber-500/5", stat: stats.reflex },
        ].map(({ label, color, stat }) => (
          <div key={label} className={`border rounded-xl p-3 ${color}`}>
            <div className="text-xs font-bold uppercase tracking-widest mb-1">{label}</div>
            {stat ? (
              <>
                <div className="font-mono text-xl font-semibold">{sgn(stat.sum)} kr</div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                  {stat.n} trades · {stat.winPct}% · snitt {sgn(stat.avg, 0)}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground mt-1">inga än</div>
            )}
          </div>
        ))}
      </div>

      {verdict && (
        <p
          className="text-sm text-muted-foreground bg-card border border-border rounded-xl px-4 py-3 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: verdict }}
        />
      )}

      {/* ── Milestone Ladder ── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5" /> Milestones
        </h3>
        <Ladder start={config.startCapital} goal={config.goalCapital} equity={stats.equity} />
      </div>

      {/* ── Add trade form ── */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> Logga trade
        </h3>

        {/* Flag: Läst / Reflex */}
        <div className="grid grid-cols-2 gap-2">
          {(["LAST", "REFLEX"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFlag(f)}
              className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                flag === f
                  ? f === "LAST"
                    ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                    : "border-amber-400 text-amber-400 bg-amber-400/10"
                  : "border-border text-muted-foreground bg-muted/30 hover:border-border/80"
              }`}
            >
              {f === "LAST" ? "📖 Läst (planerad)" : "⚡ Reflex"}
            </button>
          ))}
        </div>

        {/* Plan yes / no */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">Följde du planen?</span>
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => setFollowedPlan(v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                followedPlan === v
                  ? v
                    ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                    : "border-red-500 text-red-400 bg-red-500/10"
                  : "border-border text-muted-foreground"
              }`}
            >
              {v ? "Ja" : "Nej"}
            </button>
          ))}
        </div>

        {/* Fields row */}
        <div className="grid grid-cols-2 gap-2">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="Ticker (valfri)"
            className="bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            placeholder="Strategi"
            className="bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "LONG" | "SHORT")}
            className="bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
          <input
            type="number"
            value={leverageX}
            onChange={(e) => setLeverageX(e.target.value)}
            placeholder="Hävstång (valfri)"
            className="bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex gap-2">
          <input
            type="number"
            value={pnlKr}
            onChange={(e) => setPnlKr(e.target.value)}
            placeholder="P&L i kr  (+ vinst / − förlust / 0 break-even)"
            className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={addTrade}
            disabled={!canAdd || submitting}
            className="px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            {submitting ? "…" : "Lägg till"}
          </button>
        </div>
      </div>

      {/* ── Trade Log ── */}
      {trades.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
            Tradelog
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {[...trades].reverse().map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-medium">{t.ticker || t.strategy}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${t.flag === "LAST" ? "text-emerald-400 bg-emerald-500/10" : "text-amber-400 bg-amber-400/10"}`}>
                      {t.flag === "LAST" ? "📖" : "⚡"}
                    </span>
                    {!t.followedPlan && (
                      <span className="text-xs text-red-400 font-mono">✗plan</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {t.date} · {t.strategy} · {t.direction}
                    {t.leverageX ? ` · ${t.leverageX}x` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-semibold ${t.pnlKr >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {sgn(t.pnlKr)} kr
                  </span>
                  <button
                    onClick={() => deleteTrade(t.id)}
                    className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
