import { useState, useEffect, useRef } from "react";
import { Trash2, Plus, TrendingUp, TrendingDown, Trophy, AlertTriangle, Zap, BookOpen } from "lucide-react";

// ─── types ───────────────────────────────────────────────────────────────────

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
  config: { id: number; startCapital: number; goalCapital: number; currentCapital: number | null };
  trades: SurvivalTrade[];
  stats: Stats;
};

type OpenPosition = {
  id: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  shares: number;
  stopPrice: number | null;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}/api${path}`;

function fmt(n: number, dec = 0) {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function sgn(n: number, dec = 0) {
  return (n >= 0 ? "+" : "−") + fmt(Math.abs(n), dec);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── equity curve SVG ────────────────────────────────────────────────────────

function EquityCurve({ points, start }: { points: { i: number; eq: number }[]; start: number }) {
  if (points.length < 2) return (
    <div className="h-24 flex items-center justify-center text-xs text-muted-foreground font-mono opacity-50">
      → kurvan byggs från första trade
    </div>
  );

  const W = 600, H = 80;
  const ys = points.map((p) => p.eq);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;
  const maxX = points[points.length - 1].i || 1;

  const px = (i: number) => (i / maxX) * W;
  const py = (eq: number) => H - ((eq - minY) / rangeY) * H * 0.85 - H * 0.075;

  const poly = points.map((p) => `${px(p.i)},${py(p.eq)}`).join(" ");
  const startY = py(start);
  const isUp = ys[ys.length - 1] >= start;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
      <line x1="0" y1={startY} x2={W} y2={startY} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4 3" />
      <polyline points={poly} fill="none" stroke={isUp ? "#3FB950" : "#F85149"} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ─── milestone bar ────────────────────────────────────────────────────────────

function MilestoneLadder({ start, goal, equity }: { start: number; goal: number; equity: number }) {
  const rungs: number[] = [];
  let r = start * 2;
  while (r < goal && rungs.length < 6) { rungs.push(r); r *= 2; }
  rungs.push(goal);

  return (
    <div className="font-mono text-xs space-y-1.5">
      {rungs.map((v) => {
        const done = equity >= v;
        const pct = Math.min(1, equity / v) * 100;
        const label = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : `${Math.round(v / 1000)}k`;
        return (
          <div key={v} className="flex items-center gap-2">
            <span className={`w-3 ${done ? "text-emerald-400" : "text-muted-foreground/40"}`}>{done ? "✓" : "·"}</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-primary/50"}`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <span className={`w-8 text-right ${done ? "text-emerald-400" : "text-muted-foreground/60"}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export function ChallengeTracker() {
  const [data, setData] = useState<SurvivalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // trade form
  const [flag, setFlag] = useState<"LAST" | "REFLEX" | null>(null);
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(null);
  const [ticker, setTicker] = useState("");
  const [strategy, setStrategy] = useState("trend pullback");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [leverageX, setLeverageX] = useState("");
  const [pnlKr, setPnlKr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // config
  const [editStart, setEditStart] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [editCurrent, setEditCurrent] = useState("");

  // open positions (localStorage)
  const [positions, setPositions] = useState<OpenPosition[]>(() => {
    try { return JSON.parse(localStorage.getItem("ct_positions") ?? "[]"); } catch { return []; }
  });
  const [posForm, setPosForm] = useState({ ticker: "", direction: "LONG" as "LONG" | "SHORT", entryPrice: "", shares: "", stopPrice: "" });
  const [addingPos, setAddingPos] = useState(false);

  const savePositions = (ps: OpenPosition[]) => {
    setPositions(ps);
    localStorage.setItem("ct_positions", JSON.stringify(ps));
  };

  const load = async () => {
    try {
      const r = await fetch(api("/survival"));
      if (!r.ok) throw new Error(`${r.status}`);
      const d: SurvivalData = await r.json();
      setData(d);
      setEditStart(String(d.config.startCapital));
      setEditGoal(String(d.config.goalCapital));
      setEditCurrent(d.config.currentCapital != null ? String(d.config.currentCapital) : "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    const body: Record<string, number | null> = {};
    if (editStart) body.startCapital = Number(editStart);
    if (editGoal) body.goalCapital = Math.max(Number(editGoal), Number(editStart) * 2);
    body.currentCapital = editCurrent !== "" ? Number(editCurrent) : null;
    await fetch(api("/survival/config"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
          date: today(), ticker: ticker.trim().toUpperCase() || undefined,
          strategy, direction, leverageX: Number(leverageX) || undefined,
          pnlKr: Number(pnlKr), flag, followedPlan,
        }),
      });
      setTicker(""); setPnlKr(""); setLeverageX("");
      setFlag(null); setFollowedPlan(null);
      load();
    } finally { setSubmitting(false); }
  };

  const deleteTrade = async (id: number) => {
    if (!window.confirm("Ta bort?")) return;
    await fetch(api(`/survival/trades/${id}`), { method: "DELETE" });
    load();
  };

  const addPosition = () => {
    if (!posForm.ticker || !posForm.entryPrice || !posForm.shares) return;
    const p: OpenPosition = {
      id: uid(),
      ticker: posForm.ticker.toUpperCase(),
      direction: posForm.direction,
      entryPrice: Number(posForm.entryPrice),
      shares: Number(posForm.shares),
      stopPrice: posForm.stopPrice ? Number(posForm.stopPrice) : null,
    };
    savePositions([...positions, p]);
    setPosForm({ ticker: "", direction: "LONG", entryPrice: "", shares: "", stopPrice: "" });
    setAddingPos(false);
  };

  if (loading) return (
    <div className="font-mono text-sm text-muted-foreground py-20 text-center animate-pulse">
      Laddar Challenge Tracker…
    </div>
  );
  if (error || !data) return (
    <div className="font-mono text-sm text-destructive p-4 border border-destructive/30 rounded">
      FEL: {error ?? "Okänt fel"}
    </div>
  );

  const { config, trades, stats } = data;
  const loggedDelta = stats.equity - config.startCapital;
  const displayCapital = config.currentCapital ?? stats.equity;
  const displayDelta = config.currentCapital != null ? config.currentCapital - config.startCapital : loggedDelta;
  const goalPct = Math.min(100, (displayCapital / config.goalCapital) * 100);
  const canAdd = flag !== null && followedPlan !== null && pnlKr !== "" && strategy && isFinite(Number(pnlKr));

  // Verdict
  let verdict = "";
  if (stats.last && stats.reflex && stats.last.n >= 3 && stats.reflex.n >= 3) {
    const gap = stats.last.avg - stats.reflex.avg;
    verdict = gap > 0
      ? `📖 Läst slår reflex med ${sgn(gap, 0)} kr/trade — varje reflex du hoppar över är i snitt det värd.`
      : `⚡ Reflex går bättre just nu — men på n=${stats.reflex.n} är det brus, inte bevis.`;
  }

  return (
    <div className="font-mono space-y-4 max-w-2xl mx-auto animate-in fade-in duration-300">

      {/* ═══ HEADER ═══════════════════════════════════════════════════════════ */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3">
          CHALLENGE TRACKER · AG Investment Capital
        </div>

        {/* Capital display */}
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <div className="text-4xl font-bold tracking-tight">
              <span className={displayDelta >= 0 ? "text-emerald-400" : "text-red-400"}>
                {fmt(displayCapital)} kr
              </span>
            </div>
            <div className={`text-sm mt-0.5 ${displayDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {sgn(displayDelta)} kr · {config.startCapital ? sgn((displayDelta / config.startCapital) * 100, 1) : "0.0"}% sedan start
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Mål: {config.goalCapital >= 1_000_000 ? `${(config.goalCapital / 1_000_000).toFixed(0)}M` : `${Math.round(config.goalCapital / 1000)}k`} kr</div>
            <div className="text-primary font-bold text-sm">{goalPct.toFixed(1)}% klart</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-4">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${goalPct}%` }} />
        </div>

        {/* Config inputs */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { label: "Start kr", val: editStart, set: setEditStart },
            { label: "Aktuellt kr", val: editCurrent, set: setEditCurrent, highlight: true },
            { label: "Mål kr", val: editGoal, set: setEditGoal },
          ].map(({ label, val, set, highlight }) => (
            <div key={label}>
              <div className="text-muted-foreground mb-1">{label}</div>
              <input
                type="number"
                value={val}
                onChange={(e) => set(e.target.value)}
                onBlur={saveConfig}
                placeholder="—"
                className={`w-full bg-muted border rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary ${
                  highlight ? "border-primary/40" : "border-border"
                }`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ═══ CIRCUIT BREAKER ══════════════════════════════════════════════════ */}
      {stats.circuitBreakerActive && (
        <div className="border border-red-500/50 bg-red-500/8 rounded-lg p-4">
          <div className="text-red-400 font-bold flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4" /> CIRCUIT BREAKER — STOPP
          </div>
          <div className="text-xs text-muted-foreground">
            {stats.currentStreak} förluster i rad. Ingen ny trade idag. Kom tillbaka imorgon med en läst setup.
          </div>
        </div>
      )}

      {!stats.circuitBreakerActive && stats.currentStreak === 2 && (
        <div className="border border-amber-500/40 bg-amber-500/5 rounded-lg p-3 text-xs">
          <span className="text-amber-400 font-bold">⚠ VARNING</span>
          <span className="text-muted-foreground ml-2">2 förluster i rad — en till och circuit breakern slår till.</span>
        </div>
      )}

      {/* ═══ ÖPPNA POSITIONER ════════════════════════════════════════════════ */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            === 1 · ÖPPNA POSITIONER ({positions.length}) ===
          </span>
          <button
            onClick={() => setAddingPos((v) => !v)}
            className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" /> Lägg till
          </button>
        </div>

        {positions.length === 0 && !addingPos && (
          <div className="px-4 py-4 text-xs text-muted-foreground/50">
            → inga öppna positioner
          </div>
        )}

        {positions.map((p) => {
          const riskKr = p.stopPrice != null ? Math.abs(p.entryPrice - p.stopPrice) * p.shares : null;
          return (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-muted/20 text-sm">
              <div className="flex items-center gap-3">
                <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${p.direction === "LONG" ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
                  {p.direction}
                </span>
                <span className="font-bold">{p.ticker}</span>
                <span className="text-muted-foreground text-xs">
                  entry {fmt(p.entryPrice, 2)} · {p.shares} st
                  {p.stopPrice != null && ` · stop ${fmt(p.stopPrice, 2)}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {riskKr != null && (
                  <span className="text-xs text-muted-foreground">1R = {fmt(riskKr, 0)} kr</span>
                )}
                <button onClick={() => savePositions(positions.filter((x) => x.id !== p.id))} className="text-muted-foreground hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {addingPos && (
          <div className="px-4 py-3 border-t border-border bg-muted/20 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={posForm.ticker} onChange={(e) => setPosForm((f) => ({ ...f, ticker: e.target.value }))}
                placeholder="Ticker (t.ex. VOLV-B)" className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <select value={posForm.direction} onChange={(e) => setPosForm((f) => ({ ...f, direction: e.target.value as "LONG" | "SHORT" }))}
                className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
              <input type="number" value={posForm.entryPrice} onChange={(e) => setPosForm((f) => ({ ...f, entryPrice: e.target.value }))}
                placeholder="Entry-kurs" className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <input type="number" value={posForm.shares} onChange={(e) => setPosForm((f) => ({ ...f, shares: e.target.value }))}
                placeholder="Antal aktier" className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <input type="number" value={posForm.stopPrice} onChange={(e) => setPosForm((f) => ({ ...f, stopPrice: e.target.value }))}
                placeholder="Stop-kurs (valfri)" className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              <div className="flex gap-2">
                <button onClick={addPosition} className="flex-1 bg-primary text-primary-foreground text-xs py-1.5 rounded hover:bg-primary/90 transition-colors">
                  Lägg till
                </button>
                <button onClick={() => setAddingPos(false)} className="text-xs px-3 border border-border rounded hover:bg-muted text-muted-foreground transition-colors">
                  Avbryt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ STATISTIK ═══════════════════════════════════════════════════════ */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
          === 2 · STATISTIK ===
        </div>
        <div className="p-4 space-y-2 text-sm">
          {/* Row 1 */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { l: "TRADES", v: String(stats.totalTrades), sub: `${stats.wins}W ${stats.losses}L` },
              { l: "WIN %", v: stats.winPct != null ? `${stats.winPct}%` : "—", sub: "alla trades" },
              { l: "STREAK", v: String(stats.currentStreak), sub: `max ${stats.maxStreak}` },
              { l: "DISCIPLIN", v: stats.disciplinePct != null ? `${stats.disciplinePct}%` : "—", sub: "följde plan" },
            ].map((t) => (
              <div key={t.l} className="bg-muted/40 rounded p-2.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t.l}</div>
                <div className="text-xl font-bold mt-0.5">{t.v}</div>
                <div className="text-[10px] text-muted-foreground">{t.sub}</div>
              </div>
            ))}
          </div>

          {/* Läst vs Reflex */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { emoji: "📖", label: "LÄST", stat: stats.last, cls: "border-emerald-500/30 bg-emerald-500/5" },
              { emoji: "⚡", label: "REFLEX", stat: stats.reflex, cls: "border-amber-500/30 bg-amber-500/5" },
            ].map(({ emoji, label, stat, cls }) => (
              <div key={label} className={`border rounded p-3 ${cls}`}>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{emoji} {label}</div>
                {stat ? (
                  <>
                    <div className={`text-lg font-bold ${stat.sum >= 0 ? "text-emerald-400" : "text-red-400"}`}>{sgn(stat.sum)} kr</div>
                    <div className="text-[10px] text-muted-foreground">{stat.n} trades · {stat.winPct}% · snitt {sgn(stat.avg, 0)} kr</div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground/40">inga än</div>
                )}
              </div>
            ))}
          </div>
          {verdict && <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3 leading-relaxed">{verdict}</p>}
        </div>
      </div>

      {/* ═══ KAPITALUTVECKLING ═══════════════════════════════════════════════ */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
          === 3 · KAPITALUTVECKLING ===
        </div>
        <div className="px-4 py-3">
          <EquityCurve points={stats.equityCurve} start={config.startCapital} />
        </div>
      </div>

      {/* ═══ MILESTONES ══════════════════════════════════════════════════════ */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Trophy className="w-3 h-3" /> === 4 · MILESTONES ===
        </div>
        <div className="p-4">
          <MilestoneLadder start={config.startCapital} goal={config.goalCapital} equity={displayCapital} />
        </div>
      </div>

      {/* ═══ LOGGA TRADE ═════════════════════════════════════════════════════ */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
          === 5 · LOGGA TRADE ===
        </div>
        <div className="p-4 space-y-3">
          {/* Flag */}
          <div className="grid grid-cols-2 gap-2">
            {(["LAST", "REFLEX"] as const).map((f) => (
              <button key={f} onClick={() => setFlag(f)}
                className={`py-2 rounded border text-xs font-bold transition-colors ${flag === f
                  ? f === "LAST" ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" : "border-amber-400 text-amber-400 bg-amber-400/10"
                  : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                {f === "LAST" ? "📖 LÄST (planerad)" : "⚡ REFLEX"}
              </button>
            ))}
          </div>

          {/* Plan */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Följde planen?</span>
            {([true, false] as const).map((v) => (
              <button key={String(v)} onClick={() => setFollowedPlan(v)}
                className={`px-3 py-1 rounded border text-xs font-bold transition-colors ${followedPlan === v
                  ? v ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" : "border-red-500 text-red-400 bg-red-500/10"
                  : "border-border text-muted-foreground"}`}>
                {v ? "Ja" : "Nej"}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-2">
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker (valfri)"
              className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            <input value={strategy} onChange={(e) => setStrategy(e.target.value)} placeholder="Strategi"
              className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            <select value={direction} onChange={(e) => setDirection(e.target.value as "LONG" | "SHORT")}
              className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
            <input type="number" value={leverageX} onChange={(e) => setLeverageX(e.target.value)} placeholder="Hävstång (valfri)"
              className="bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div className="flex gap-2">
            <input type="number" value={pnlKr} onChange={(e) => setPnlKr(e.target.value)}
              placeholder="P&L i kr  (+ vinst / − förlust / 0 break-even)"
              className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            <button onClick={addTrade} disabled={!canAdd || submitting}
              className="px-5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-bold disabled:opacity-40 hover:bg-primary/90 transition-colors">
              {submitting ? "…" : "LOGGA"}
            </button>
          </div>
        </div>
      </div>

      {/* ═══ TRADELOG ═════════════════════════════════════════════════════════ */}
      {trades.length > 0 && (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
            === 6 · TRADELOG ({trades.length} trades) ===
          </div>
          <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
            {[...trades].reverse().map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`px-1 rounded ${t.flag === "LAST" ? "text-emerald-400 bg-emerald-500/10" : "text-amber-400 bg-amber-400/10"}`}>
                    {t.flag === "LAST" ? "📖" : "⚡"}
                  </span>
                  <span className="font-bold">{t.ticker || t.strategy}</span>
                  <span className="text-muted-foreground">{t.date} · {t.strategy} · {t.direction}{t.leverageX ? ` ${t.leverageX}x` : ""}</span>
                  {!t.followedPlan && <span className="text-red-400 font-bold">✗plan</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-bold ${t.pnlKr >= 0 ? "text-emerald-400" : "text-red-400"}`}>{sgn(t.pnlKr)} kr</span>
                  <button onClick={() => deleteTrade(t.id)} className="text-muted-foreground hover:text-red-400 transition-colors">
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
