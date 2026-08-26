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
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "./omxs30TickerMap";
import {
  calculateWilderRsi,
  volumeMultiplierFromQuote,
} from "./marketIndicators";
import { fetchFreshEdgeAiData } from "./edgeAiSource";
import { lockScreenerSession, synchronizeCandidates } from "./candidateSynchronization";
import { calendarDaysUntil } from "./marketCalendar";
import { mapEdgeAiSetup } from "./edgeAiMapping";
import { withRetry } from "./retry";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Start checking from 08:00 UTC (10:00 CEST) — market has been open 1 h.
// EdgeAI data is generated mid-morning; the scheduler retries every 5 min
// and imports as soon as today's data is available (generatedAt check below).
const EARLIEST_HOUR_UTC   = 8;
const EARLIEST_MINUTE_UTC = 0;

function daysUntil(date: Date | number | null | undefined): number | null {
  return calendarDaysUntil(date);
}

// In-memory status — reset on server restart
export let schedulerStatus: {
  lastChecked: string | null;
  lastImported: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
} = {
  lastChecked: null,
  lastImported: null,
  lastError: null,
  nextCheckAt: null,
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

async function fetchOmxsMarketWeather(): Promise<{
  omxsValue: number; perf5d: number; perf1m: number; perf3m: number; marketRsi: number;
}> {
  const now = new Date();
  const ninetyFiveDaysAgo = new Date(now.getTime() - 95 * 86_400_000);
  const history = await withRetry(() => yf.historical("^OMX", {
    period1: ninetyFiveDaysAgo,
    period2: now,
    interval: "1d",
  })) as Array<{ close: number }>;

  if (history.length === 0) return { omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0 };

  const omxsValue = history[history.length - 1].close;
  const perf5d  = history.length >= 6  ? ((omxsValue - history[history.length - 6].close)  / history[history.length - 6].close)  * 100 : 0;
  const perf1m  = history.length >= 22 ? ((omxsValue - history[history.length - 22].close) / history[history.length - 22].close) * 100 : 0;
  const perf3m  = history.length >= 64 ? ((omxsValue - history[history.length - 64].close) / history[history.length - 64].close) * 100 : 0;
  const marketRsi = calculateWilderRsi(history.map((bar) => Number(bar.close))) ?? 0;
  return { omxsValue, perf5d, perf1m, perf3m, marketRsi };
}

async function runImport(date: string): Promise<void> {
  logger.info({ date }, "[scheduler] Fetching EdgeAI data.json");

  const edgeData = await fetchFreshEdgeAiData(15_000);

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

  const rankCounterSE: Record<string, number> = {};
  const rankCounterUS: Record<string, number> = {};
  const seMapped = seSetups.map((s) => mapEdgeAiSetup(s, "SE", rankCounterSE));
  const usMapped = usSetups.map((s) => mapEdgeAiSetup(s, "US", rankCounterUS));
  const mapped = [...seMapped, ...usMapped];

  // Enrich volume from live Yahoo Finance data. A missing result is retained as
  // missing and logged; downstream guardrails turn it into a no-trade rather than
  // quietly treating it as a legitimate 0,0x ratio.
  await Promise.allSettled(
    mapped.map(async (c) => {
      try {
        const q = (await withRetry(() => yf.quote(resolveYahooTicker(c.ticker), {}, { validateResult: false }))) as any;
        const volumeMultiplier = volumeMultiplierFromQuote(q);
        if (volumeMultiplier != null) {
          c.volMultiplier = volumeMultiplier;
        } else {
          logger.warn({ ticker: c.ticker }, "[scheduler] Volume enrichment missing Yahoo volume or average fields");
        }
        c.earningsInDays = daysUntil(q.earningsTimestamp);
      } catch (err: any) {
        logger.warn({ ticker: c.ticker, err: err.message }, "[scheduler] Volume enrichment failed");
      }
    }),
  );

  try {
    await db.transaction(async (tx) => {
      await lockScreenerSession(tx, date);
      const [alreadyStored] = await tx
        .select({ id: screenerSessionsTable.id })
        .from(screenerSessionsTable)
        .where(eq(screenerSessionsTable.date, date));
      if (alreadyStored) {
        logger.info({ date, sessionId: alreadyStored.id }, "[scheduler] Session already exists after lock — skipping");
        return;
      }
      const [inserted] = await tx
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
        edgeWinRate: se?.edge?.winRate != null
          ? (se.edge.winRate > 1 ? se.edge.winRate / 100 : se.edge.winRate)
          : null,
        edgePF: se?.edge?.profitFactor ?? null,
        edgeN: se?.edge?.n ?? null,
        })
        .returning();

      await synchronizeCandidates(tx, inserted.id, mapped);
      // Fresh insert: nothing existed before, so a diff would be all-"added" noise — skip it.
      logger.info(
        { date, sessionId: inserted.id, seSetups: seSetups.length, usSetups: usSetups.length, omxsValue: mw.omxsValue },
        "[scheduler] Auto-import complete",
      );
    });
  } catch (err: any) {
    throw new Error(`DB insert failed: ${err.message}`);
  }
}



let tickInFlight = false;

async function tick() {
  if (tickInFlight) {
    logger.warn("[scheduler] Skipping overlapping tick");
    return;
  }
  tickInFlight = true;
  try {
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
  } finally {
    tickInFlight = false;
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
