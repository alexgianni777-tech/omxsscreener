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
import { timingSafeEqual } from "node:crypto";
import {
  deduplicateCandidates,
  lockScreenerSession,
  synchronizeCandidates,
} from "../lib/candidateSynchronization";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

/**
 * Enrich volMultiplier for each candidate via live Yahoo Finance data.
 * Uses intraday vol when ≥20% of daily avg (meaningful session),
 * otherwise falls back to avg10d/avg3m trend ratio (stable at open / pre-market).
 */
async function enrichVolMultiplier(
  candidates: Array<{ ticker: string; volMultiplier: number }>,
): Promise<void> {
  await Promise.allSettled(
    candidates.map(async (c) => {
      try {
        const q = (await yf.quote(resolveYahooTicker(c.ticker), {}, { validateResult: false })) as any;
        const vol:    number = q.regularMarketVolume       ?? 0;
        const avg10d: number = q.averageDailyVolume10Day   ?? 0;
        const avg3m:  number = q.averageDailyVolume3Month  ?? 0;
        if (avg10d > 0 && vol / avg10d >= 0.2) {
          c.volMultiplier = Math.round((vol / avg10d) * 10) / 10;
        } else if (avg10d > 0 && avg3m > 0) {
          c.volMultiplier = Math.round((avg10d / avg3m) * 10) / 10;
        }
      } catch { /* keep parsed fallback */ }
    }),
  );
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

  const { date, marketWeather, candidates } = session;
  {
    const { skipped } = deduplicateCandidates(
      candidates.map((candidate) => ({ ...candidate, market: "SE" })),
    );
    if (skipped.length > 0) {
      console.warn(`[telegram import] Skipped duplicate candidates: ${skipped.join(", ")}`);
    }
  }

  // Enrich vol from live Yahoo Finance — overrides the bot's parsed 0.0x values
  await enrichVolMultiplier(candidates);

  const buildRow = (
    sessionId: number,
    c: (typeof candidates)[number],
    preserved?: { outcome: string; exitPrice: number | null; outcomeNotes: string | null },
  ) => ({
    sessionId,
    market: "SE" as const,   // Telegram screener always imports SE stocks
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
    distFrom20dH: c.distFrom20dH,
    gapWarning: c.gapWarning ?? undefined,
    direction: c.direction,
    entryPrice: c.entryPrice,
    stopPrice: c.stopPrice,
    targetPrice: c.targetPrice,
    rr: c.rr,
    oneR: c.oneR,
    outcome: (preserved?.outcome ?? "PENDING") as "WIN" | "LOSS" | "SKIP" | "PENDING",
    exitPrice: preserved?.exitPrice ?? null,
    outcomeNotes: preserved?.outcomeNotes ?? null,
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
      source: "telegram",
    };
    const [stored] = existing
      ? await tx.update(screenerSessionsTable).set(sessionRow).where(eq(screenerSessionsTable.id, existing.id)).returning()
      : await tx.insert(screenerSessionsTable).values({ date, ...sessionRow }).returning();
    const { candidates: storedCandidates, diff } = await synchronizeCandidates(
      tx,
      stored.id,
      candidates.map((candidate) => buildRow(stored.id, candidate)),
    );
    if (existing) {
      await tx
        .update(screenerSessionsTable)
        .set({ lastImportDiff: diff, lastImportAt: new Date() })
        .where(eq(screenerSessionsTable.id, stored.id));
    }
    return { stored, candidateCount: storedCandidates.length, updated: Boolean(existing) };
  });

  logger.info({ date, sessionId: result.stored.id, candidates: result.candidateCount }, "[telegram-import] Session synchronized");
  res.status(result.updated ? 200 : 201).json({ sessionId: result.stored.id, date, candidateCount: result.candidateCount });
});

export default router;
