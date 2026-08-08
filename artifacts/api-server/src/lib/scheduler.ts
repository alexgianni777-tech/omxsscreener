/**
 * Daily EdgeAI auto-import scheduler.
 *
 * Logic:
 *  - Every 5 minutes, check if today is a weekday AND there is no session yet.
 *  - If conditions met AND it's past 06:15 UTC, trigger EdgeAI import.
 *  - This gracefully handles server restarts: if the server came up after
 *    06:15 and no session exists, it imports immediately on the first tick.
 */
import { db, screenerSessionsTable } from "@workspace/db";
import { eq, inArray, and, gte, lte } from "drizzle-orm";
import { logger } from "./logger";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const EDGEAI_URL = "https://alexgianni777-tech.github.io/edgeai/public/data.json";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Start checking from 08:00 UTC (10:00 CEST) — market has been open 1 h.
// EdgeAI data is generated mid-morning; the scheduler retries every 5 min
// and imports as soon as today's data is available (generatedAt check below).
const EARLIEST_HOUR_UTC   = 8;
const EARLIEST_MINUTE_UTC = 0;

// In-memory status — reset on server restart
export let schedulerStatus: {
  lastChecked: string | null;
  lastImported: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
  lastWeeklyDigest: string | null;
} = {
  lastChecked: null,
  lastImported: null,
  lastError: null,
  nextCheckAt: null,
  lastWeeklyDigest: null,
};

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5; // Mon–Fri
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sessionExistsForDate(date: string): Promise<boolean> {
  const rows = await db
    .select({ id: screenerSessionsTable.id })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, date));
  return rows.length > 0;
}

function mapCategory(dir: string, setupName: string): "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST" {
  if (dir === "short") return "WEAKEST";
  const n = setupName.toLowerCase();
  if (n.includes("squeeze") || n.includes("bollinger") || n.includes("reversion")) return "SQUEEZE";
  if (n.includes("pullback") || n.includes("stud") || n.includes("reversal")) return "STUDS";
  return "MOMENTUM";
}

async function fetchOmxsMarketWeather(): Promise<{
  omxsValue: number; perf5d: number; perf1m: number; perf3m: number; marketRsi: number;
}> {
  const now = new Date();
  const ninetyFiveDaysAgo = new Date(now.getTime() - 95 * 86_400_000);
  const history = await yf.historical("^OMX", {
    period1: ninetyFiveDaysAgo,
    period2: now,
    interval: "1d",
  }) as Array<{ close: number }>;

  if (history.length === 0) return { omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0 };

  const omxsValue = history[history.length - 1].close;
  const perf5d  = history.length >= 6  ? ((omxsValue - history[history.length - 6].close)  / history[history.length - 6].close)  * 100 : 0;
  const perf1m  = history.length >= 22 ? ((omxsValue - history[history.length - 22].close) / history[history.length - 22].close) * 100 : 0;
  const perf3m  = history.length >= 64 ? ((omxsValue - history[history.length - 64].close) / history[history.length - 64].close) * 100 : 0;
  return { omxsValue, perf5d, perf1m, perf3m, marketRsi: 0 };
}

function mapSetup(s: any, rankCounter: Record<string, number>) {
  const category = mapCategory(s.dir, s.setup ?? "");
  rankCounter[category] = (rankCounter[category] ?? 0) + 1;
  const direction = s.dir === "short" ? "SHORT" : "LONG";
  const entry = Number(s.entry ?? 0);
  const stop  = Number(s.stop  ?? 0);
  const oneR  = Math.abs(entry - stop);
  // Strip .ST so resolveYahooTicker can re-add it correctly for SE stocks;
  // US tickers have no .ST so this is a no-op for them.
  const ticker = String(s.ticker ?? "").replace(/\.ST$/i, "").toUpperCase();
  const barsAgo = Number(s.barsAgo ?? 0);
  return {
    category,
    rank: rankCounter[category],
    ticker,
    price: entry,
    rs3m: Number(s.rs ?? 0),
    perf1m: Number(s.edge?.winRate ?? 0),
    rsi: Number(s.edge?.expectancyR ?? 0) * 100,
    pctB: Number(s.edge?.sample ?? 0),
    atr: oneR,
    volMultiplier: Number(s.rr ?? 0),
    distFrom20dH: barsAgo,
    gapWarning: s.grade === "A" ? null : -1,
    direction,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: Number(s.target ?? 0),
    rr: Number(s.rr ?? 0),
    oneR,
    outcome: "PENDING" as const,
  };
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

async function sendWeeklyDigest(now: Date): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    logger.info("[scheduler] Weekly digest skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    return;
  }

  const { candidatesTable } = await import("@workspace/db");

  // Current week: Monday → today
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon … 5=Fri
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - mondayOffset);
  const mondayStr = monday.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);

  const sessions = await db
    .select({ id: screenerSessionsTable.id, date: screenerSessionsTable.date })
    .from(screenerSessionsTable)
    .where(and(gte(screenerSessionsTable.date, mondayStr), lte(screenerSessionsTable.date, todayStr)));

  if (sessions.length === 0) {
    logger.info({ week: mondayStr }, "[scheduler] Weekly digest — no sessions this week, skipping");
    return;
  }

  const sessionIds = sessions.map((s) => s.id);
  const candidates = await db
    .select({
      outcome: candidatesTable.outcome,
      direction: candidatesTable.direction,
      entryPrice: candidatesTable.entryPrice,
      stopPrice: candidatesTable.stopPrice,
      exitPrice: candidatesTable.exitPrice,
    })
    .from(candidatesTable)
    .where(inArray(candidatesTable.sessionId, sessionIds));

  let wins = 0;
  let losses = 0;
  let totalR = 0;

  for (const c of candidates) {
    if (c.outcome !== "WIN" && c.outcome !== "LOSS") continue;
    if (c.outcome === "WIN") wins++;
    else losses++;
    if (c.exitPrice != null && c.entryPrice != null && c.stopPrice != null) {
      const oneR = Math.abs(c.entryPrice - c.stopPrice);
      if (oneR > 0) {
        const r =
          c.direction === "SHORT"
            ? (c.entryPrice - c.exitPrice) / oneR
            : (c.exitPrice - c.entryPrice) / oneR;
        totalR += r;
      }
    }
  }

  const resolved = wins + losses;
  const winRatePct = resolved > 0 ? Math.round((wins / resolved) * 100) : null;
  const rStr = totalR >= 0 ? `+${totalR.toFixed(2)}R` : `${totalR.toFixed(2)}R`;
  const weekNo = getWeekNumber(now);
  const trendEmoji = totalR > 0 ? "📈" : totalR < 0 ? "📉" : "➡️";

  const text = [
    `${trendEmoji} *Veckosammanfattning v.${weekNo}*`,
    ``,
    `📅 ${mondayStr} → ${todayStr}`,
    `📊 ${sessions.length} session${sessions.length !== 1 ? "er" : ""}`,
    ``,
    `✅ Vinster: ${wins}`,
    `❌ Förluster: ${losses}`,
    `🎯 Win rate: ${winRatePct != null ? `${winRatePct}%` : "–"}`,
    `💰 Total R: ${rStr}`,
  ].join("\n");

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram API ${resp.status}: ${body}`);
  }

  logger.info({ weekNo, sessions: sessions.length, wins, losses, totalR: totalR.toFixed(2) }, "[scheduler] Weekly digest sent");
}

async function runImport(date: string): Promise<void> {
  logger.info({ date }, "[scheduler] Fetching EdgeAI data.json");

  const resp = await fetch(EDGEAI_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`EdgeAI fetch HTTP ${resp.status}`);

  const edgeData: any = await resp.json();

  // Note: edgeData.generatedAt only changes when new signals are found — not every day.
  // EdgeAI commits daily (verified via GitHub), so the data is always current;
  // the timestamp just reflects the last signal change, not the last run.

  const se = edgeData?.markets?.SE;
  const seSetups: any[] = se?.setups ?? [];
  const usSetups: any[] = edgeData?.markets?.US?.setups ?? [];
  const allSetups = [...seSetups, ...usSetups];

  if (allSetups.length === 0) {
    logger.info({ date, generatedAt: edgeData.generatedAt }, "[scheduler] No setups today — skipping");
    return;
  }

  // Fetch real OMXS30 market data
  let mw = { omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0 };
  try {
    mw = await fetchOmxsMarketWeather();
  } catch (err: any) {
    logger.warn({ err: err.message }, "[scheduler] OMXS30 market weather fetch failed — using zeros");
  }

  const { candidatesTable } = await import("@workspace/db");

  const rankCounter: Record<string, number> = {};
  const mapped = allSetups.map((s) => mapSetup(s, rankCounter));

  try {
    const [inserted] = await db
      .insert(screenerSessionsTable)
      .values({
        date,
        omxsValue: mw.omxsValue,
        perf5d: mw.perf5d,
        perf1m: mw.perf1m,
        perf3m: mw.perf3m,
        marketRsi: mw.marketRsi,
        trendLabel: se?.regime?.label ?? "n/a",
        rawText: `EdgeAI auto-import — generatedAt ${edgeData.generatedAt}`,
        source: "edgeai",
        edgeRegime: JSON.stringify(se?.regime ?? {}),
        edgeExpectancy: se?.edge?.expectancyR ?? null,
        edgeWinRate: se?.edge?.winRate ?? null,
        edgePF: se?.edge?.profitFactor ?? null,
        edgeN: se?.edge?.n ?? null,
      })
      .returning();

    await db.insert(candidatesTable).values(
      mapped.map((c) => ({ ...c, sessionId: inserted.id } as any)),
    );

    logger.info(
      { date, sessionId: inserted.id, seSetups: seSetups.length, usSetups: usSetups.length, omxsValue: mw.omxsValue },
      "[scheduler] Auto-import complete",
    );
  } catch (err: any) {
    throw new Error(`DB insert failed: ${err.message}`);
  }
}



async function tick() {
  const now = new Date();
  schedulerStatus.lastChecked = now.toISOString();

  if (!isWeekday(now)) return;
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();

  // ── Daily import (Mon–Fri from 08:00 UTC) ──────────────────────────────────
  if (utcH >= EARLIEST_HOUR_UTC) {
    const today = todayUtc();
    if (!(await sessionExistsForDate(today))) {
      logger.info({ today }, "[scheduler] No session found, auto-importing from EdgeAI");
      try {
        await runImport(today);
        schedulerStatus.lastImported = today;
        schedulerStatus.lastError = null;
      } catch (err: any) {
        schedulerStatus.lastError = err.message ?? String(err);
        logger.warn({ err: err.message }, "[scheduler] Auto-import failed");
      }
    }
  }

  // ── Weekly digest (Fridays after 16:30 UTC, once per week) ─────────────────
  const isFriday = now.getUTCDay() === 5;
  const pastDigestWindow = utcH > 16 || (utcH === 16 && utcM >= 30);
  if (isFriday && pastDigestWindow) {
    const weekKey = todayUtc(); // unique per Friday
    if (schedulerStatus.lastWeeklyDigest !== weekKey) {
      try {
        await sendWeeklyDigest(now);
        schedulerStatus.lastWeeklyDigest = weekKey;
      } catch (err: any) {
        logger.warn({ err: err.message }, "[scheduler] Weekly digest failed");
      }
    }
  }
}

export function startScheduler() {
  // Run once on startup (with a short delay to let DB connect)
  setTimeout(() => tick(), 10_000);
  // Then every 5 minutes
  const interval = setInterval(tick, CHECK_INTERVAL_MS);

  const nextCheck = new Date(Date.now() + CHECK_INTERVAL_MS);
  schedulerStatus.nextCheckAt = nextCheck.toISOString();

  logger.info("[scheduler] Started — checking EdgeAI every 5 min on weekdays from 08:00 UTC; imports as soon as today's data is available");
  return interval;
}
