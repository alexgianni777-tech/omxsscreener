import { Router, type IRouter } from "express";
import { eq, ne, sql, and, inArray } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
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
    .select({ id: screenerSessionsTable.id })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, session.date));

  const { force } = parsed.data;

  if (existing.length > 0 && !force) {
    // Return 409 with details about any logged outcomes so the UI can show
    // exactly what would be preserved on a force re-import.
    const existingId = existing[0].id;
    const affectedOutcomes = await db
      .select({
        ticker: candidatesTable.ticker,
        category: candidatesTable.category,
        outcome: candidatesTable.outcome,
        exitPrice: candidatesTable.exitPrice,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existingId))
      .then((rows) => rows.filter((r) => r.outcome !== "PENDING"));

    res.status(409).json({
      error: `A session for ${session.date} already exists`,
      sessionId: existingId,
      date: session.date,
      affectedOutcomes,
    });
    return;
  }

  // ---------- helpers shared by both insert and force-update paths ----------
  const buildCandidateRow = (
    sessionId: number,
    c: (typeof session.candidates)[number],
    earningsInDays: number | null,
    preserved?: { outcome: string; exitPrice: number | null; outcomeNotes: string | null },
  ) => ({
    sessionId,
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

    // Snapshot existing outcomes before deleting
    const existingCandidates = await db
      .select({
        ticker: candidatesTable.ticker,
        outcome: candidatesTable.outcome,
        exitPrice: candidatesTable.exitPrice,
        outcomeNotes: candidatesTable.outcomeNotes,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existingId));

    const outcomeByTicker = new Map(
      existingCandidates
        .filter((c) => c.outcome !== "PENDING")
        .map((c) => [c.ticker, { outcome: c.outcome, exitPrice: c.exitPrice, outcomeNotes: c.outcomeNotes }]),
    );

    // Delete old candidates then update session metadata
    await db.delete(candidatesTable).where(eq(candidatesTable.sessionId, existingId));

    const [updatedSession] = await db
      .update(screenerSessionsTable)
      .set({
        omxsValue: session.marketWeather.omxsValue,
        perf5d: session.marketWeather.perf5d,
        perf1m: session.marketWeather.perf1m,
        perf3m: session.marketWeather.perf3m,
        marketRsi: session.marketWeather.rsi,
        trendLabel: session.marketWeather.trendLabel,
        rawText: parsed.data.rawText,
      })
      .where(eq(screenerSessionsTable.id, existingId))
      .returning();

    const updatedCandidates = await db
      .insert(candidatesTable)
      .values(
        session.candidates.map((c) =>
          buildCandidateRow(updatedSession.id, c, earningsBatch.get(c.ticker) ?? null, outcomeByTicker.get(c.ticker)),
        ),
      )
      .returning();

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
      candidates: updatedCandidates.map(mapCandidate),
    });

    res.status(200).json(response);
    return;
  }

  // ---------- normal insert (no existing session) ----------
  const [insertedSession] = await db
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

  const insertedCandidates = await db
    .insert(candidatesTable)
    .values(
      session.candidates.map((c) =>
        buildCandidateRow(insertedSession.id, c, earningsBatch.get(c.ticker) ?? null),
      ),
    )
    .returning();

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
    candidates: insertedCandidates.map(mapCandidate),
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

  // Update session metadata
  const [updatedSession] = await db
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

  // Load all existing candidates for this session
  const existingCandidates = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, params.data.id));

  // Build a lookup map: "CATEGORY:TICKER" -> existing candidate
  const existingMap = new Map(
    existingCandidates.map((c) => [`${c.category}:${c.ticker}`, c])
  );

  // Build a set of keys present in the new import
  const newKeys = new Set(
    parsedSession.candidates.map((c) => `${c.category}:${c.ticker}`)
  );

  // Determine which existing PENDING candidates are no longer in the new import → delete them
  const toDelete = existingCandidates.filter(
    (c) => c.outcome === "PENDING" && !newKeys.has(`${c.category}:${c.ticker}`)
  );

  if (toDelete.length > 0) {
    await db
      .delete(candidatesTable)
      .where(
        and(
          eq(candidatesTable.sessionId, params.data.id),
          inArray(
            candidatesTable.id,
            toDelete.map((c) => c.id)
          )
        )
      );
  }

  // Upsert each candidate from the new import
  const resultCandidates: (typeof candidatesTable.$inferSelect)[] = [];

  for (const c of parsedSession.candidates) {
    const key = `${c.category}:${c.ticker}`;
    const existing = existingMap.get(key);

    if (existing) {
      // Update price/signal fields but preserve outcome, exitPrice, outcomeNotes
      const [updated] = await db
        .update(candidatesTable)
        .set({
          rank: c.rank,
          price: c.price,
          rs3m: c.rs3m,
          perf1m: c.perf1m,
          rsi: c.rsi,
          pctB: c.pctB,
          atr: c.atr,
          volMultiplier: c.volMultiplier,
          distFrom20dH: c.distFrom20dH,
          gapWarning: c.gapWarning ?? null,
          direction: c.direction,
          entryPrice: c.entryPrice,
          stopPrice: c.stopPrice,
          targetPrice: c.targetPrice,
          rr: c.rr,
          oneR: c.oneR,
        })
        .where(eq(candidatesTable.id, existing.id))
        .returning();
      resultCandidates.push(updated);
    } else {
      // New candidate: insert as PENDING
      const [inserted] = await db
        .insert(candidatesTable)
        .values({
          sessionId: params.data.id,
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
          outcome: "PENDING" as const,
        })
        .returning();
      resultCandidates.push(inserted);
    }
  }

  // Also retain WIN/LOSS/SKIP candidates that were not in the new import
  const retainedTracked = existingCandidates.filter(
    (c) => c.outcome !== "PENDING" && !newKeys.has(`${c.category}:${c.ticker}`)
  );
  resultCandidates.push(...retainedTracked);

  // Sort by category, then rank
  resultCandidates.sort((a, b) =>
    a.category !== b.category
      ? a.category.localeCompare(b.category)
      : a.rank - b.rank
  );

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
      candidates: resultCandidates.map(mapCandidate),
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
    candidates: candidates.map(mapCandidate),
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
  });
});

// DELETE /screener/sessions/:id
router.delete("/screener/sessions/:id", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.sendStatus(204);
});

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
  distFrom20dH: number;
  gapWarning: number | null;
  earningsInDays: number | null;
  direction: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  oneR: number;
  outcome: string;
  exitPrice: number | null;
  outcomeNotes: string | null;
}) {
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
    distFrom20dH: c.distFrom20dH,
    gapWarning: c.gapWarning ?? null,
    earningsInDays: c.earningsInDays ?? null,
    direction: c.direction,
    entryPrice: c.entryPrice,
    stopPrice: c.stopPrice,
    targetPrice: c.targetPrice,
    rr: c.rr,
    oneR: c.oneR,
    outcome: c.outcome,
    exitPrice: c.exitPrice ?? null,
    outcomeNotes: c.outcomeNotes ?? null,
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
    // Enforce max 3 per session
    const existing = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(and(
        eq(candidatesTable.sessionId, candidate.sessionId),
        eq(candidatesTable.isTop3Pick as any, true),
      ));
    if (existing.length >= 3 && !existing.some((p) => p.id === id)) {
      res.status(409).json({ error: "Max 3 picks per session — ta bort en stjärna först" });
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

/** Fetch earningsInDays for a ticker at a given session date (YYYY-MM-DD).
 *  Returns null on any error. */
async function fetchEarningsInDaysAt(ticker: string, sessionDate: string): Promise<number | null> {
  try {
    const quote = await _yf.quote(resolveYahooTicker(ticker));
    const earningsTs: Date | null = (quote as any).earningsTimestamp ?? null;
    if (!earningsTs || !(earningsTs instanceof Date)) return null;
    const ms = earningsTs.getTime();
    if (!ms || isNaN(ms)) return null;
    const earningsDateStr = earningsTs.toISOString().slice(0, 10);
    return Math.round(
      (new Date(earningsDateStr).getTime() - new Date(sessionDate).getTime()) / 86_400_000,
    );
  } catch {
    return null;
  }
}
