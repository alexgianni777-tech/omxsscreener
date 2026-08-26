import { Router, type IRouter } from "express";
import { eq, ne, sql, and, inArray } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable, survivalTradesTable } from "@workspace/db";
import {
  ImportSessionBody,
  ImportSessionResponse,
  ListSessionsResponse,
  GetSessionParams,
  GetSessionResponse,
  DeleteSessionParams,
  ReimportSessionParams,
  ReimportSessionBody,
  ReimportSessionResponse,
} from "@workspace/api-zod";
import { parseScreenerText, ScreenerParseError } from "../lib/screenerParser";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";
import { volumeMultiplierFromQuote } from "../lib/marketIndicators";
import { calendarDaysBetween } from "../lib/marketCalendar";
import { reviewCandidate, reviewSession } from "../lib/screeningReview";
import { logger } from "../lib/logger";
import { withRetry } from "../lib/retry";
import {
  candidateIdentity,
  deduplicateCandidates,
  lockScreenerSession,
  mergeCandidateInputs,
  synchronizeCandidates,
} from "../lib/candidateSynchronization";

const router: IRouter = Router();

// POST /screener/sessions/import
router.post("/screener/sessions/import", async (req, res): Promise<void> => {
  const parsed = ImportSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let session;
  try {
    session = parseScreenerText(parsed.data.rawText);
  } catch (err) {
    if (err instanceof ScreenerParseError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Check for duplicate date
  const existing = await db
    .select({ id: screenerSessionsTable.id, source: screenerSessionsTable.source })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, session.date));

  const { force } = parsed.data;
  {
    const { skipped } = deduplicateCandidates(
      session.candidates.map((candidate) => ({ ...candidate, market: "SE" })),
    );
    if (skipped.length > 0) {
      logger.warn({ skipped }, "Screener import skipped duplicate candidates");
    }
  }

  if (existing.length > 0 && !force) {
    // Return 409 with details about any logged outcomes so the UI can show
    // exactly what would be preserved on a force re-import — and which
    // still-pending candidates would be REMOVED because they're absent from
    // this new import (logged outcomes are never removed).
    const existingId = existing[0].id;
    const existingRows = await db
      .select({
        ticker: candidatesTable.ticker,
        category: candidatesTable.category,
        direction: candidatesTable.direction,
        market: candidatesTable.market,
        outcome: candidatesTable.outcome,
        exitPrice: candidatesTable.exitPrice,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existingId));

    const affectedOutcomes = existingRows.filter((r) => r.outcome !== "PENDING");

    const incomingIdentities = new Set(
      session.candidates.map((c) => candidateIdentity({ ...c, market: "SE" })),
    );
    const wouldRemove = existingRows
      .filter((r) => r.outcome === "PENDING" && !incomingIdentities.has(candidateIdentity(r as any)))
      .map(({ ticker, category, direction, market }) => ({ ticker, category, direction, market }));

    res.status(409).json({
      error: `A session for ${session.date} already exists`,
      sessionId: existingId,
      date: session.date,
      affectedOutcomes,
      wouldRemove,
    });
    return;
  }

  // ---------- helpers shared by both insert and force-update paths ----------
  // Fetch live vol ratio (current / 10-day avg) from Yahoo Finance.
  // Overrides the Telegram bot's broken "vol 0.0x" field when it fails.
  const volMap = await enrichVolMultiplier(
    session.candidates.map((c) => c.ticker),
    _yf,
  );

  const buildCandidateRow = (
    sessionId: number,
    c: (typeof session.candidates)[number],
    earningsInDays: number | null,
    preserved?: { outcome: string; exitPrice: number | null; outcomeNotes: string | null },
  ) => ({
    sessionId,
    market: "SE" as const,   // screener text is always SE stocks
    category: c.category,
    rank: c.rank,
    ticker: c.ticker,
    price: c.price,
    rs3m: c.rs3m,
    perf1m: c.perf1m,
    rsi: c.rsi,
    pctB: c.pctB,
    atr: c.atr,
    volMultiplier: volMap.get(c.ticker) ?? c.volMultiplier,
    signalRsi: c.rsi,
    signalGapPct: c.gapWarning ?? null,
    distFrom20dH: c.distFrom20dH,
    gapWarning: c.gapWarning ?? undefined,
    earningsInDays: earningsInDays ?? undefined,
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

  const earningsBatch = await fetchEarningsBatch(
    session.candidates.map((c) => c.ticker),
    session.date,
  );

  // ---------- force re-import: preserve outcomes, replace everything else ----------
  if (existing.length > 0 && force) {
    const existingId = existing[0].id;
    const isEdgeAISession = existing[0].source === "edgeai";

    const existingCandidates = await db
      .select({
        id: candidatesTable.id,
        sessionId: candidatesTable.sessionId,
        category: candidatesTable.category,
        rank: candidatesTable.rank,
        ticker: candidatesTable.ticker,
        market: candidatesTable.market,
        price: candidatesTable.price,
        rs3m: candidatesTable.rs3m,
        perf1m: candidatesTable.perf1m,
        rsi: candidatesTable.rsi,
        pctB: candidatesTable.pctB,
        atr: candidatesTable.atr,
        volMultiplier: candidatesTable.volMultiplier,
        signalRsi: candidatesTable.signalRsi,
        signalGapPct: candidatesTable.signalGapPct,
        distFrom20dH: candidatesTable.distFrom20dH,
        gapWarning: candidatesTable.gapWarning,
        earningsInDays: candidatesTable.earningsInDays,
        direction: candidatesTable.direction,
        entryPrice: candidatesTable.entryPrice,
        stopPrice: candidatesTable.stopPrice,
        targetPrice: candidatesTable.targetPrice,
        rr: candidatesTable.rr,
        oneR: candidatesTable.oneR,
        outcome: candidatesTable.outcome,
        exitPrice: candidatesTable.exitPrice,
        outcomeNotes: candidatesTable.outcomeNotes,
        isTop3Pick: candidatesTable.isTop3Pick,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existingId));

    const { updatedSession, updatedCandidates, diff } = await db.transaction(async (tx) => {
      await lockScreenerSession(tx, session.date);
      const [updatedSession] = await tx
        .update(screenerSessionsTable)
        .set({
          omxsValue: session.marketWeather.omxsValue,
          perf5d: session.marketWeather.perf5d,
          perf1m: session.marketWeather.perf1m,
          perf3m: session.marketWeather.perf3m,
          marketRsi: session.marketWeather.rsi,
          trendLabel: session.marketWeather.trendLabel,
          rawText: parsed.data.rawText,
          source: isEdgeAISession ? "mixed" : existing[0].source,
        })
        .where(eq(screenerSessionsTable.id, existingId))
        .returning();
      const incomingRows = mergeCandidateInputs(
        session.candidates.map((candidate) =>
          buildCandidateRow(updatedSession.id, candidate, earningsBatch.get(candidate.ticker) ?? null),
        ),
        existingCandidates.map(({ id, ...candidate }) => candidate as any),
      );
      const { candidates: updatedCandidates, diff } = await synchronizeCandidates(tx, updatedSession.id, incomingRows);
      await tx
        .update(screenerSessionsTable)
        .set({ lastImportDiff: diff, lastImportAt: new Date() })
        .where(eq(screenerSessionsTable.id, updatedSession.id));
      return { updatedSession, updatedCandidates, diff };
    });

    const linkedIds = await fetchLinkedTradeIds(updatedCandidates.map((c: any) => c.id));
    const response = ImportSessionResponse.parse({
      id: updatedSession.id,
      date: updatedSession.date,
      marketWeather: {
        omxsValue: updatedSession.omxsValue,
        perf5d: updatedSession.perf5d,
        perf1m: updatedSession.perf1m,
        perf3m: updatedSession.perf3m,
        rsi: updatedSession.marketRsi,
        trendLabel: updatedSession.trendLabel,
      },
      candidates: updatedCandidates.map((c: any) => mapCandidate(c, linkedIds.has(c.id))),
      importDiff: diff,
    });

    res.status(200).json(response);
    return;
  }

  // ---------- normal insert (no existing session) ----------
  const { insertedSession, insertedCandidates } = await db.transaction(async (tx) => {
    await lockScreenerSession(tx, session.date);
    const [alreadyStored] = await tx
      .select({ id: screenerSessionsTable.id })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, session.date));
    if (alreadyStored) {
      throw new Error(`A session for ${session.date} already exists`);
    }
    const [insertedSession] = await tx
      .insert(screenerSessionsTable)
      .values({
      date: session.date,
      omxsValue: session.marketWeather.omxsValue,
      perf5d: session.marketWeather.perf5d,
      perf1m: session.marketWeather.perf1m,
      perf3m: session.marketWeather.perf3m,
      marketRsi: session.marketWeather.rsi,
      trendLabel: session.marketWeather.trendLabel,
      rawText: parsed.data.rawText,
      })
      .returning();
    const { candidates: insertedCandidates } = await synchronizeCandidates(
      tx,
      insertedSession.id,
      session.candidates.map((c) =>
        buildCandidateRow(insertedSession.id, c, earningsBatch.get(c.ticker) ?? null),
      ),
    );
    return { insertedSession, insertedCandidates };
  });

  const response = ImportSessionResponse.parse({
    id: insertedSession.id,
    date: insertedSession.date,
    marketWeather: {
      omxsValue: insertedSession.omxsValue,
      perf5d: insertedSession.perf5d,
      perf1m: insertedSession.perf1m,
      perf3m: insertedSession.perf3m,
      rsi: insertedSession.marketRsi,
      trendLabel: insertedSession.trendLabel,
    },
    candidates: insertedCandidates.map((c: any) => mapCandidate(c)),
  });

  res.status(201).json(response);
});

// PUT /screener/sessions/:id/reimport
router.put("/screener/sessions/:id/reimport", async (req, res): Promise<void> => {
  const params = ReimportSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = ReimportSessionBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  // Load the existing session
  const [existingSession] = await db
    .select()
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, params.data.id));

  if (!existingSession) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Parse the new raw text
  let parsedSession;
  try {
    parsedSession = parseScreenerText(bodyParsed.data.rawText);
  } catch (err) {
    if (err instanceof ScreenerParseError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Verify the date matches
  if (parsedSession.date !== existingSession.date) {
    res
      .status(400)
      .json({
        error: `Date mismatch: imported text has date ${parsedSession.date}, but session has date ${existingSession.date}`,
      });
    return;
  }

  let updatedSession: typeof existingSession;
  let resultCandidates: (typeof candidatesTable.$inferSelect)[];
  let diff: import("../lib/candidateSynchronization").CandidateSyncDiff;
  try {
    ({ updatedSession, resultCandidates, diff } = await db.transaction(async (tx) => {
      await lockScreenerSession(tx, existingSession.date);
      const [updatedSession] = await tx
        .update(screenerSessionsTable)
        .set({
          omxsValue: parsedSession.marketWeather.omxsValue,
          perf5d: parsedSession.marketWeather.perf5d,
          perf1m: parsedSession.marketWeather.perf1m,
          perf3m: parsedSession.marketWeather.perf3m,
          marketRsi: parsedSession.marketWeather.rsi,
          trendLabel: parsedSession.marketWeather.trendLabel,
          rawText: bodyParsed.data.rawText,
        })
        .where(eq(screenerSessionsTable.id, params.data.id))
        .returning();
      const rows = parsedSession.candidates.map((candidate) => ({
        sessionId: updatedSession.id,
        market: "SE" as const,
        category: candidate.category,
        rank: candidate.rank,
        ticker: candidate.ticker,
        price: candidate.price,
        rs3m: candidate.rs3m,
        perf1m: candidate.perf1m,
        rsi: candidate.rsi,
        pctB: candidate.pctB,
        atr: candidate.atr,
        volMultiplier: candidate.volMultiplier,
        signalRsi: candidate.rsi,
        signalGapPct: candidate.gapWarning ?? null,
        distFrom20dH: candidate.distFrom20dH,
        gapWarning: candidate.gapWarning ?? null,
        direction: candidate.direction,
        entryPrice: candidate.entryPrice,
        stopPrice: candidate.stopPrice,
        targetPrice: candidate.targetPrice,
        rr: candidate.rr,
        oneR: candidate.oneR,
        outcome: "PENDING" as const,
      }));
      const { candidates: resultCandidates, diff } = await synchronizeCandidates(tx, updatedSession.id, rows);
      await tx
        .update(screenerSessionsTable)
        .set({ lastImportDiff: diff, lastImportAt: new Date() })
        .where(eq(screenerSessionsTable.id, updatedSession.id));
      return { updatedSession, resultCandidates, diff };
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not synchronize candidates" });
    return;
  }

  const linkedIds = await fetchLinkedTradeIds(resultCandidates.map((c) => c.id));
  res.json(
    ReimportSessionResponse.parse({
      id: updatedSession.id,
      date: updatedSession.date,
      marketWeather: {
        omxsValue: updatedSession.omxsValue,
        perf5d: updatedSession.perf5d,
        perf1m: updatedSession.perf1m,
        perf3m: updatedSession.perf3m,
        rsi: updatedSession.marketRsi,
        trendLabel: updatedSession.trendLabel,
      },
      candidates: resultCandidates.map((c) => mapCandidate(c, linkedIds.has(c.id))),
      importDiff: diff,
    })
  );
});

// GET /screener/sessions
router.get("/screener/sessions", async (req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(screenerSessionsTable)
    .orderBy(sql`${screenerSessionsTable.date} DESC`);

  // For each session, count candidates per category and tracked outcomes
  const result = await Promise.all(
    sessions.map(async (s) => {
      const candidateCounts = await db
        .select({
          category: candidatesTable.category,
          outcome: candidatesTable.outcome,
          count: sql<number>`cast(count(*) as integer)`,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, s.id))
        .groupBy(candidatesTable.category, candidatesTable.outcome);

      let momentumCount = 0;
      let squeezeCount = 0;
      let studsCount = 0;
      let weakestCount = 0;
      let trackedCount = 0;
      let totalCandidates = 0;

      for (const row of candidateCounts) {
        const count = Number(row.count);
        totalCandidates += count;
        if (row.outcome !== "PENDING") trackedCount += count;
        if (row.category === "MOMENTUM") momentumCount += count;
        if (row.category === "SQUEEZE") squeezeCount += count;
        if (row.category === "STUDS") studsCount += count;
        if (row.category === "WEAKEST") weakestCount += count;
      }

      return {
        id: s.id,
        date: s.date,
        marketWeather: {
          omxsValue: s.omxsValue,
          perf5d: s.perf5d,
          perf1m: s.perf1m,
          perf3m: s.perf3m,
          rsi: s.marketRsi,
          trendLabel: s.trendLabel,
        },
        momentumCount,
        squeezeCount,
        studsCount,
        weakestCount,
        totalCandidates,
        trackedCount,
      };
    })
  );

  res.json(ListSessionsResponse.parse(result));
});

// GET /screener/sessions/:id
router.get("/screener/sessions/:id/delete-impact", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [session] = await db
    .select({ id: screenerSessionsTable.id, date: screenerSessionsTable.date })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const candidates = await db
    .select({ id: candidatesTable.id, outcome: candidatesTable.outcome })
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, session.id));
  const ids = candidates.map((candidate) => candidate.id);
  const linkedTrades = ids.length
    ? await db
        .select({ id: survivalTradesTable.id })
        .from(survivalTradesTable)
        .where(inArray(survivalTradesTable.sourceCandidateId, ids))
    : [];
  res.json({
    sessionId: session.id,
    date: session.date,
    candidates: candidates.length,
    resolvedOutcomes: candidates.filter((candidate) => candidate.outcome !== "PENDING").length,
    linkedChallengeTrades: linkedTrades.length,
  });
});

router.get("/screener/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const candidates = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, session.id))
    .orderBy(candidatesTable.category, candidatesTable.rank);

  const linkedIds = await fetchLinkedTradeIds(candidates.map((c) => c.id));
  const candidatesWithReview = candidates.map((candidate) => ({
    ...mapCandidate(candidate, linkedIds.has(candidate.id)),
    review: reviewCandidate(candidate, session.source ?? null),
  }));
  const sessionReview = reviewSession(
    candidatesWithReview.map((candidate) => candidate.review),
    session.marketRsi,
  );

  const parsed = GetSessionResponse.parse({
    id: session.id,
    date: session.date,
    marketWeather: {
      omxsValue: session.omxsValue,
      perf5d: session.perf5d,
      perf1m: session.perf1m,
      perf3m: session.perf3m,
      rsi: session.marketRsi,
      trendLabel: session.trendLabel,
    },
    candidates: candidatesWithReview,
    sessionReview,
    importDiff: (session.lastImportDiff as any) ?? undefined,
  });

  // Append fields not in Zod schema — passed through directly
  res.json({
    ...parsed,
    createdAt: session.createdAt ?? null,
    source: session.source ?? null,
    edgeRegime: session.edgeRegime ? (() => { try { return JSON.parse(session.edgeRegime!); } catch { return null; } })() : null,
    edgeExpectancy: session.edgeExpectancy ?? null,
    edgeWinRate: session.edgeWinRate ?? null,
    edgePF: session.edgePF ?? null,
    edgeN: session.edgeN ?? null,
    lastImportAt: session.lastImportAt ?? null,
  });
});

// DELETE /screener/sessions/:id
router.delete("/screener/sessions/:id", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.query.force !== "true") {
    res.status(409).json({
      error: "Deletion requires explicit force confirmation. Fetch delete-impact first and retry with force=true.",
    });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.id, params.data.id));
    if (!session) return null;
    await lockScreenerSession(tx, session.date);
    const candidates = await tx
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, session.id));
    const candidateIds = candidates.map((candidate) => candidate.id);
    if (candidateIds.length > 0) {
      await tx
        .delete(survivalTradesTable)
        .where(inArray(survivalTradesTable.sourceCandidateId, candidateIds));
    }
    const [removed] = await tx
      .delete(screenerSessionsTable)
      .where(eq(screenerSessionsTable.id, params.data.id))
      .returning();
    return removed;
  });

  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.sendStatus(204);
});

/** Fetch which of the given candidate ids have a linked Challenge Tracker trade. */
async function fetchLinkedTradeIds(candidateIds: number[]): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await db
    .select({ sourceCandidateId: survivalTradesTable.sourceCandidateId })
    .from(survivalTradesTable)
    .where(inArray(survivalTradesTable.sourceCandidateId, candidateIds));
  return new Set(rows.map((r) => r.sourceCandidateId).filter((id): id is number => id != null));
}

function mapCandidate(c: {
  id: number;
  sessionId: number;
  category: string;
  rank: number;
  ticker: string;
  price: number;
  rs3m: number;
  perf1m: number;
  rsi: number;
  pctB: number;
  atr: number;
  volMultiplier: number;
  signalRsi: number | null;
  signalGapPct: number | null;
  distFrom20dH: number;
  gapWarning: number | null;
  earningsInDays: number | null;
  market: string;
  direction: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  oneR: number;
  outcome: string;
  exitPrice: number | null;
  outcomeNotes: string | null;
  isTop3Pick?: boolean | null;
}, hasLinkedTrade = false) {
  return {
    id: c.id,
    sessionId: c.sessionId,
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
    signalRsi: c.signalRsi ?? null,
    signalGapPct: c.signalGapPct ?? null,
    distFrom20dH: c.distFrom20dH,
    gapWarning: c.gapWarning ?? null,
    earningsInDays: c.earningsInDays ?? null,
    market: c.market,
    direction: c.direction,
    entryPrice: c.entryPrice,
    stopPrice: c.stopPrice,
    targetPrice: c.targetPrice,
    rr: c.rr,
    oneR: c.oneR,
    outcome: c.outcome,
    exitPrice: c.exitPrice ?? null,
    outcomeNotes: c.outcomeNotes ?? null,
    isTop3Pick: c.isTop3Pick ?? false,
    hasLinkedTrade,
  };
}

// PATCH /screener/candidates/:id/top3pick — toggle manual Top 3 star (max 3 per session)
router.patch("/screener/candidates/:id/top3pick", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { isTop3Pick } = req.body ?? {};
  if (typeof isTop3Pick !== "boolean") {
    res.status(400).json({ error: "isTop3Pick must be boolean" });
    return;
  }

  // Check existing candidate + session
  const [candidate] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, id)).limit(1);
  if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }

  if (isTop3Pick) {
    // Enforce max 3 per direction per session (3 LONG köp-picks + 3 SHORT sälj-picks)
    const existing = await db
      .select({ id: candidatesTable.id, direction: candidatesTable.direction })
      .from(candidatesTable)
      .where(and(
        eq(candidatesTable.sessionId, candidate.sessionId),
        eq(candidatesTable.isTop3Pick as any, true),
      ));
    const sameDir = existing.filter((p) => p.direction === candidate.direction);
    if (sameDir.length >= 3 && !sameDir.some((p) => p.id === id)) {
      const dirLabel = candidate.direction === "SHORT" ? "sälj-picks" : "köp-picks";
      res.status(409).json({ error: `Max 3 ${dirLabel} — ta bort en stjärna först` });
      return;
    }
  }

  const [updated] = await db
    .update(candidatesTable)
    .set({ isTop3Pick } as any)
    .where(eq(candidatesTable.id, id))
    .returning();

  res.json(updated);
});

export default router;

const _yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

/** Fetch earningsInDays for all unique tickers in parallel, keyed by ticker. */
async function fetchEarningsBatch(
  tickers: string[],
  sessionDate: string,
): Promise<Map<string, number | null>> {
  const unique = [...new Set(tickers)];
  const results = await Promise.all(
    unique.map(async (t) => [t, await fetchEarningsInDaysAt(t, sessionDate)] as const),
  );
  return new Map(results);
}

/**
 * Fetch live volume ratio (regularMarketVolume / averageDailyVolume10Day) for
 * a batch of screener tickers. Returns a map keyed by the original ticker string.
 * Missing source data is deliberately omitted so the UI can present "saknas".
 */
/**
 * Volume ratio strategy:
 *  - If today's intraday volume is already ≥20% of the 10-day average (i.e. we're
 *    well into the trading session), use realtime ratio: today / avg10d.
 *  - Otherwise (early-morning imports, pre-market, etc.) fall back to the stable
 *    recent-vs-historical ratio: avg10d / avg3m.  This tells the trader whether
 *    recent activity is elevated or depressed compared to the 3-month baseline.
 */
async function enrichVolMultiplier(
  tickers: string[],
  yf: InstanceType<typeof YahooFinance>,
): Promise<Map<string, number>> {
  const volMap = new Map<string, number>();
  await Promise.allSettled(
    [...new Set(tickers)].map(async (ticker) => {
      try {
        const q = (await withRetry(() => yf.quote(resolveYahooTicker(ticker), {}, { validateResult: false }))) as any;
        const volumeMultiplier = volumeMultiplierFromQuote(q);
        if (volumeMultiplier != null) {
          volMap.set(ticker, volumeMultiplier);
        } else {
          logger.warn({ ticker }, "Volume enrichment missing Yahoo volume or average fields");
        }
      } catch (err: any) {
        logger.warn({ ticker, err: err.message }, "Volume enrichment failed");
      }
    }),
  );
  return volMap;
}

/** Fetch earningsInDays for a ticker at a given session date (YYYY-MM-DD).
 *  Returns null on any error. */
async function fetchEarningsInDaysAt(ticker: string, sessionDate: string): Promise<number | null> {
  try {
    const quote = await _yf.quote(resolveYahooTicker(ticker));
    const earningsTs: Date | null = (quote as any).earningsTimestamp ?? null;
    if (!earningsTs || !(earningsTs instanceof Date)) return null;
    const sessionStart = new Date(`${sessionDate}T00:00:00.000Z`);
    return calendarDaysBetween(earningsTs, sessionStart);
  } catch {
    return null;
  }
}
