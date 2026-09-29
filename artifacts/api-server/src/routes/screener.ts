import { Router, type IRouter } from "express";
import { eq, ne, sql } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import {
  ImportSessionBody,
  ImportSessionResponse,
  ListSessionsResponse,
  GetSessionParams,
  GetSessionResponse,
  DeleteSessionParams,
} from "@workspace/api-zod";
import { parseScreenerText, ScreenerParseError } from "../lib/screenerParser";

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
    // exactly what would be preserved on a force re-import (#9 / #10).
    const existingId = existing[0].id;
    const affectedOutcomes = await db
      .select({
        ticker: candidatesTable.ticker,
        category: candidatesTable.category,
        outcome: candidatesTable.outcome,
        exitPrice: candidatesTable.exitPrice,
      })
      .from(candidatesTable)
      .where(
        eq(candidatesTable.sessionId, existingId),
      )
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

  // ---------- import / force re-import, atomically ----------
  const result = await db.transaction(async (tx) => {
    if (existing.length > 0 && force) {
      const existingId = existing[0].id;

      const existingCandidates = await tx
        .select({
          ticker: candidatesTable.ticker,
          category: candidatesTable.category,
          direction: candidatesTable.direction,
          outcome: candidatesTable.outcome,
          exitPrice: candidatesTable.exitPrice,
          outcomeNotes: candidatesTable.outcomeNotes,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existingId));

      const outcomeMap = new Map(
        existingCandidates
          .filter((cand) => cand.outcome !== "PENDING")
          .map((cand) => [
            `${cand.ticker}|${cand.direction}|${cand.category}`,
            {
              outcome: cand.outcome,
              exitPrice: cand.exitPrice,
              outcomeNotes: cand.outcomeNotes,
            },
          ]),
      );

      await tx.delete(candidatesTable).where(eq(candidatesTable.sessionId, existingId));

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
          source: null,
          edgeRegime: null,
          edgeExpectancy: null,
          edgeWinRate: null,
          edgePF: null,
          edgeN: null,
        })
        .where(eq(screenerSessionsTable.id, existingId))
        .returning();

      const updatedCandidates = await tx
        .insert(candidatesTable)
        .values(
          session.candidates.map((cand) => {
            const preserved = outcomeMap.get(
              `${cand.ticker}|${cand.direction}|${cand.category}`,
            );
            return buildCandidateRow(updatedSession.id, cand, preserved);
          }),
        )
        .returning();

      return {
        status: 200 as const,
        session: updatedSession,
        candidates: updatedCandidates,
      };
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

    const insertedCandidates = await tx
      .insert(candidatesTable)
      .values(session.candidates.map((cand) => buildCandidateRow(insertedSession.id, cand)))
      .returning();

    return {
      status: 201 as const,
      session: insertedSession,
      candidates: insertedCandidates,
    };
  });

  const response = ImportSessionResponse.parse({
    id: result.session.id,
    date: result.session.date,
    marketWeather: {
      omxsValue: result.session.omxsValue,
      perf5d: result.session.perf5d,
      perf1m: result.session.perf1m,
      perf3m: result.session.perf3m,
      rsi: result.session.marketRsi,
      trendLabel: result.session.trendLabel,
    },
    candidates: result.candidates.map(mapCandidate),
  });

  res.status(result.status).json(response);
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

  // Append EdgeAI metadata (not in Zod schema — passed through directly)
  res.json({
    ...parsed,
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

export default router;
