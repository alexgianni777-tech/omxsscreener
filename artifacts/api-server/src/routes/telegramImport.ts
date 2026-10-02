/**
 * POST /api/telegram-import
 *
 * Accepts the raw screener text from the Telegram bot (via GitHub Actions)
 * and upserts a session + candidates in the DB.
 *
 * Auth: Authorization: Bearer <TELEGRAM_IMPORT_SECRET>
 * Body: { text: string }
 *
 * Response:
 *   201 { sessionId, date, candidateCount }   — fresh import
 *   200 { sessionId, date, candidateCount }   — updated existing session (outcomes preserved)
 *   400 { error }                             — parse failure
 *   401 { error }                             — missing/wrong token
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdministrator } from "../middlewares/authMiddleware";
import { eq } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import { parseScreenerText, ScreenerParseError } from "../lib/screenerParser";
import { logger } from "../lib/logger";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";
import { fetchCompletedVolumeBatch } from "../lib/completedVolumeBatch";
import { calendarDaysBetween } from "../lib/marketCalendar";
import { timingSafeEqual } from "node:crypto";
import {
  deduplicateCandidates,
  lockScreenerSession,
  preserveCandidateInputs,
  synchronizeCandidates,
  candidateIdentity,
} from "../lib/candidateSynchronization";
import { aggregateSessionSource } from "../lib/candidateSynchronizationPolicy";
import { snapshotNewSessionTop3 } from "../lib/top3SelectionPolicy";
import { isAcceptedSignalDate, stockholmSignalDate } from "../lib/signalDatePolicy";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

type EarningsObservation = {
  earningsInDays: number | null;
  knowledge: "SIGNAL_TIME" | "UNKNOWN";
  observedAt: Date | null;
};

const UNKNOWN_EARNINGS: EarningsObservation = {
  earningsInDays: null,
  knowledge: "UNKNOWN",
  observedAt: null,
};

function stockholmCalendarDate(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Current Yahoo calendar data is evidence only for a genuinely same-day signal. */
async function fetchEarningsBatch(
  tickers: string[],
  signalDate: string,
): Promise<Map<string, EarningsObservation>> {
  if (signalDate !== stockholmCalendarDate()) {
    return new Map(tickers.map((ticker) => [ticker, UNKNOWN_EARNINGS]));
  }

  const uniqueTickers = [...new Set(tickers)];
  const observations = await Promise.all(uniqueTickers.map(async (ticker) => {
    try {
      const quote = await yf.quote(resolveYahooTicker(ticker));
      const earningsTimestamp: Date | null = (quote as any).earningsTimestamp ?? null;
      if (!earningsTimestamp || !(earningsTimestamp instanceof Date) || !Number.isFinite(earningsTimestamp.getTime())) {
        return [ticker, UNKNOWN_EARNINGS] as const;
      }
      const observedAt = new Date();
      if (stockholmCalendarDate(observedAt) !== signalDate) {
        return [ticker, UNKNOWN_EARNINGS] as const;
      }
      return [ticker, {
        earningsInDays: calendarDaysBetween(earningsTimestamp, new Date(`${signalDate}T00:00:00.000Z`)),
        knowledge: "SIGNAL_TIME",
        observedAt,
      }] as const;
    } catch (err: any) {
      logger.warn({ ticker, err: err.message }, "[telegram-import] Yahoo earnings calendar lookup failed");
      return [ticker, UNKNOWN_EARNINGS] as const;
    }
  }));
  return new Map(observations);
}

/** Verify report-date volume against the preceding ten completed Yahoo trading days. */
async function enrichVolMultiplier(
  candidates: Array<{ ticker: string; volMultiplier: number }>,
  reportDate: string,
): Promise<Map<string, { multiplier: number; asOf: string }>> {
  const volumes = await fetchCompletedVolumeBatch(
    yf,
    candidates.map((candidate) => ({ ticker: candidate.ticker, market: "SE", asOfDate: reportDate })),
  );
  for (const candidate of candidates) {
    const verified = volumes.get(`SE:${candidate.ticker}:${reportDate}`);
    // A bot-provided ratio is not proof of the completed Yahoo bar.
    candidate.volMultiplier = verified?.multiplier ?? 0;
  }
  return new Map(candidates.flatMap((candidate) => {
    const verified = volumes.get(`SE:${candidate.ticker}:${reportDate}`);
    return verified ? [[candidate.ticker, verified] as const] : [];
  }));
}

const router: IRouter = Router();

// GET /api/telegram-import/status — shows pipeline health without exposing secret
router.get("/telegram-import/status", requireAdministrator, async (_req, res: Response): Promise<void> => {
  const { db, screenerSessionsTable } = await import("@workspace/db");
  const { desc } = await import("drizzle-orm");
  const secretConfigured = !!process.env.TELEGRAM_IMPORT_SECRET;
  const [latest] = await db
    .select({ date: screenerSessionsTable.date, source: screenerSessionsTable.source, createdAt: screenerSessionsTable.createdAt })
    .from(screenerSessionsTable)
    .orderBy(desc(screenerSessionsTable.createdAt))
    .limit(1);
  res.json({
    secretConfigured,
    latestSession: latest ?? null,
    note: secretConfigured
      ? "Token configured — ensure DASHBOARD_IMPORT_SECRET in GitHub matches TELEGRAM_IMPORT_SECRET in Replit"
      : "TELEGRAM_IMPORT_SECRET not set — set it in Replit Secrets",
  });
});

router.post("/telegram-import", async (req: Request, res: Response): Promise<void> => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = process.env.TELEGRAM_IMPORT_SECRET;
  if (!secret) {
    res.status(503).json({ error: "TELEGRAM_IMPORT_SECRET not configured on server" });
    return;
  }
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const received = Buffer.from(token);
  const expected = Buffer.from(secret);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    res.status(401).json({ error: "Invalid or missing bearer token" });
    return;
  }

  // ── Body ────────────────────────────────────────────────────────────────────
  const rawText: unknown = req.body?.text;
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    res.status(400).json({ error: 'Body must be JSON with a non-empty "text" string' });
    return;
  }

  // ── Parse ───────────────────────────────────────────────────────────────────
  let session: ReturnType<typeof parseScreenerText>;
  try {
    session = parseScreenerText(rawText);
  } catch (err) {
    if (err instanceof ScreenerParseError) {
      logger.warn({ err: err.message }, "[telegram-import] Parse error");
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const { date: reportDate, marketWeather, candidates } = session;
  const today = stockholmSignalDate();
  const date = isAcceptedSignalDate(reportDate, today) ? today : reportDate;
  const [existingSessionForDate] = await db
    .select({ id: screenerSessionsTable.id })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, date));
  if (existingSessionForDate) {
    const priorCandidates = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existingSessionForDate.id));
    const incomingIdentities = new Set(candidates.map((candidate) =>
      candidateIdentity({ ...candidate, market: "SE", signalSource: "telegram", signalDate: reportDate }),
    ));
    const mismatch = priorCandidates.find((candidate) =>
      candidate.signalDate != null &&
      incomingIdentities.has(candidateIdentity(candidate)) &&
      candidate.signalDate !== reportDate,
    );
    if (mismatch) {
      res.status(409).json({
        error: `Signal date mismatch for ${mismatch.ticker}: stored ${mismatch.signalDate}, incoming ${reportDate}`,
      });
      return;
    }
  }
  {
    const { skipped } = deduplicateCandidates(
      candidates.map((candidate) => ({ ...candidate, market: "SE" })),
    );
    if (skipped.length > 0) {
      logger.warn({ skipped }, "[telegram-import] Skipped duplicate candidates");
    }
  }

  // The report date, not import time, is the provenance of its daily signal.
  const verifiedVolumes = await enrichVolMultiplier(candidates, reportDate);
  const earningsBatch = await fetchEarningsBatch(candidates.map((candidate) => candidate.ticker), reportDate);

  const buildRow = (
    sessionId: number,
    c: (typeof candidates)[number],
    earnings: EarningsObservation,
    preserved?: {
      outcome: string; exitPrice: number | null; outcomeNotes: string | null;
      resolutionMethod: "MANUAL_EXIT" | "TARGET_HIT" | "STOP_HIT" | null;
      resolutionQuality: "RECORDED_EXIT" | "ASSUMED_LEVEL" | "LEGACY_UNKNOWN" | null;
      realizedR: number | null;
    },
  ) => ({
    sessionId,
    signalDate: reportDate,
    market: "SE" as const,   // Telegram screener always imports SE stocks
    signalSource: "telegram" as const,
    origin: "legacy" as const,
    category: c.category,
    rank: c.rank,
    ticker: c.ticker,
    price: c.price,
    rs3m: c.rs3m,
    perf1m: c.perf1m,
    rsi: c.rsi,
    pctB: c.pctB,
    atr: c.atr,
    volMultiplier: c.volMultiplier,
    volumeAsOf: verifiedVolumes.get(c.ticker)?.asOf ?? null,
    signalRsi: c.rsi,
    signalGapPct: c.gapWarning ?? null,
    distFrom20dH: c.distFrom20dH,
    gapWarning: c.gapWarning ?? undefined,
    earningsInDays: earnings.earningsInDays ?? undefined,
    earningsKnowledge: earnings.knowledge,
    earningsObservedAt: earnings.observedAt,
    direction: c.direction,
    entryPrice: c.entryPrice,
    stopPrice: c.stopPrice,
    targetPrice: c.targetPrice,
    rr: c.rr,
    oneR: c.oneR,
    outcome: (preserved?.outcome ?? "PENDING") as "WIN" | "LOSS" | "SKIP" | "PENDING",
    exitPrice: preserved?.exitPrice ?? null,
    outcomeNotes: preserved?.outcomeNotes ?? null,
    resolutionMethod: preserved?.resolutionMethod ?? null,
    resolutionQuality: preserved?.resolutionQuality ?? null,
    realizedR: preserved?.realizedR ?? null,
  });

  // ── Upsert ──────────────────────────────────────────────────────────────────
  const result = await db.transaction(async (tx) => {
    await lockScreenerSession(tx, date);
    const [existing] = await tx
      .select()
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, date));
    const sessionRow = {
      omxsValue: marketWeather.omxsValue,
      perf5d: marketWeather.perf5d,
      perf1m: marketWeather.perf1m,
      perf3m: marketWeather.perf3m,
      marketRsi: marketWeather.rsi,
      trendLabel: marketWeather.trendLabel,
      rawText,
    };
    const [stored] = existing
      ? await tx.update(screenerSessionsTable).set(sessionRow).where(eq(screenerSessionsTable.id, existing.id)).returning()
      : await tx.insert(screenerSessionsTable).values({ date, ...sessionRow }).returning();
    const existingCandidates = existing
      ? await tx
          .select()
          .from(candidatesTable)
          .where(eq(candidatesTable.sessionId, stored.id))
      : [];
    const { candidates: storedCandidates, diff } = await synchronizeCandidates(
      tx,
      stored.id,
       preserveCandidateInputs(
        candidates.map((candidate) =>
          buildRow(stored.id, candidate, earningsBatch.get(candidate.ticker) ?? UNKNOWN_EARNINGS),
        ),
        existingCandidates.map(({ id, ...candidate }) => candidate),
      ),
    );
    const aggregateSource = aggregateSessionSource(
      existing?.source,
      storedCandidates.map((candidate) => candidate.signalSource),
    );
    if (existing) {
      await tx
        .update(screenerSessionsTable)
        .set({ lastImportDiff: diff, lastImportAt: new Date(), source: aggregateSource })
        .where(eq(screenerSessionsTable.id, stored.id));
      await snapshotNewSessionTop3(
        tx,
        { id: stored.id, date, source: aggregateSource },
        candidates.map((candidate) =>
          buildRow(stored.id, candidate, earningsBatch.get(candidate.ticker) ?? UNKNOWN_EARNINGS),
        ),
      );
    } else {
      await tx
        .update(screenerSessionsTable)
        .set({ source: aggregateSource })
        .where(eq(screenerSessionsTable.id, stored.id));
      await snapshotNewSessionTop3(
        tx,
        { id: stored.id, date, source: aggregateSource },
        candidates.map((candidate) =>
          buildRow(stored.id, candidate, earningsBatch.get(candidate.ticker) ?? UNKNOWN_EARNINGS),
        ),
      );
    }
    return { stored, candidateCount: storedCandidates.length, updated: Boolean(existing) };
  });

  logger.info({ date, sessionId: result.stored.id, candidates: result.candidateCount }, "[telegram-import] Session synchronized");
  res.status(result.updated ? 200 : 201).json({ sessionId: result.stored.id, date, candidateCount: result.candidateCount });
});

export default router;
