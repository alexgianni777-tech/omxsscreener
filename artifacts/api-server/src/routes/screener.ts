import { Router, type IRouter } from "express";
import { eq, ne, sql, and, inArray } from "drizzle-orm";
import {
  db,
  screenerSessionsTable,
  candidatesTable,
  survivalTradesTable,
  top3SelectionSnapshotsTable,
} from "@workspace/db";
import {
  ImportSessionBody,
  ListSessionsResponse,
  GetSessionParams,
  GetSessionResponse,
  DeleteSessionParams,
  ReimportSessionParams,
  ReimportSessionBody,
  SetCandidateTop3AnnotationParams,
  SetCandidateTop3AnnotationBody,
  SetCandidateTop3AnnotationResponse,
} from "@workspace/api-zod";
import { parseScreenerText, ScreenerParseError } from "../lib/screenerParser";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";
import { fetchCompletedVolumeBatch } from "../lib/completedVolumeBatch";
import { calendarDaysBetween } from "../lib/marketCalendar";
import { decideCandidate, reviewCandidate, reviewSession } from "../lib/screeningReview";
import { logger } from "../lib/logger";
import { candidateOrigin } from "../lib/candidateOrigin";
import { withRetry } from "../lib/retry";
import {
  deduplicateCandidates,
  lockScreenerSession,
  mergeCandidateInputs,
  pendingCandidatesToRemove,
  synchronizeCandidates,
  candidateIdentity,
} from "../lib/candidateSynchronization";
import { aggregateSessionSource } from "../lib/candidateSynchronizationPolicy";
import { snapshotNewSessionTop3 } from "../lib/top3SelectionPolicy";
import { describeTop3Snapshot } from "../lib/top3SnapshotStatus";
import { buildTop3LiveSelection, type Top3LiveCandidate } from "../lib/top3LiveSelection";
import { parseSessionImportResponse } from "../lib/sessionImportResponse";

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

  const reportDate = session.date;
  if (parsed.data.targetDate) {
    const targetDate = parsed.data.targetDate instanceof Date
      ? parsed.data.targetDate.toISOString().slice(0, 10)
      : parsed.data.targetDate;
    session = { ...session, date: targetDate };
  }

  // Check for duplicate date
  const existing = await db
    .select({ id: screenerSessionsTable.id, source: screenerSessionsTable.source })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, session.date));

  const { force } = parsed.data;
  // A force import may update a trading/display session, but cannot rewrite a
  // candidate's source-day provenance.
  if (existing.length > 0 && force) {
    const existingRows = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existing[0].id));
    const incomingByIdentity = new Map(
      session.candidates.map((candidate) => {
        const row = { ...candidate, market: "SE", signalSource: "manual" };
        return [candidateIdentity(row), reportDate] as const;
      }),
    );
    const mismatch = existingRows.find((row) =>
      row.signalDate != null &&
      incomingByIdentity.has(candidateIdentity(row)) &&
      incomingByIdentity.get(candidateIdentity(row)) !== row.signalDate,
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
        id: candidatesTable.id,
        ticker: candidatesTable.ticker,
        category: candidatesTable.category,
        direction: candidatesTable.direction,
        market: candidatesTable.market,
        signalSource: candidatesTable.signalSource,
        outcome: candidatesTable.outcome,
        exitPrice: candidatesTable.exitPrice,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, existingId));

    const affectedOutcomes = existingRows.filter((r) => r.outcome !== "PENDING");
    const selectedSnapshotRows = await db
      .select({ candidateId: top3SelectionSnapshotsTable.candidateId })
      .from(top3SelectionSnapshotsTable)
      .where(and(
        eq(top3SelectionSnapshotsTable.sessionId, existingId),
        eq(top3SelectionSnapshotsTable.selected, true),
      ));

    const wouldRemove = pendingCandidatesToRemove(
      existingRows as Array<typeof existingRows[number] & { category: string }>,
      session.candidates.map((c) => ({ ...c, market: "SE" })),
      new Set(selectedSnapshotRows.map((row) => row.candidateId)),
    );

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
  // The parsed report date remains the source date even when a manual paste
  // is explicitly assigned to today's session for trading.
  const volMap = await enrichVolMultiplier(session.candidates.map((c) => c.ticker), _yf, reportDate);

  const buildCandidateRow = (
    sessionId: number,
    c: (typeof session.candidates)[number],
    earnings: EarningsObservation,
    preserved?: {
      outcome: string; exitPrice: number | null; outcomeNotes: string | null;
      resolutionMethod: "MANUAL_EXIT" | "TARGET_HIT" | "STOP_HIT" | "TIME_EXIT" | null;
      resolutionQuality: "RECORDED_EXIT" | "ASSUMED_LEVEL" | "LEGACY_UNKNOWN" | null;
      realizedR: number | null;
    },
  ) => ({
    sessionId,
    signalDate: reportDate,
    market: "SE" as const,   // screener text is always SE stocks
    signalSource: "manual" as const,
    origin: "manual" as const,
    category: c.category,
    rank: c.rank,
    ticker: c.ticker,
    price: c.price,
    rs3m: c.rs3m,
    perf1m: c.perf1m,
    rsi: c.rsi,
    pctB: c.pctB,
    atr: c.atr,
    volMultiplier: volMap.get(c.ticker)?.multiplier ?? 0,
    volumeAsOf: volMap.get(c.ticker)?.asOf ?? null,
    signalRsi: c.rsi,
    signalGapPct: c.gapWarning ?? null,
    edgeWinRate: null,
    edgeExpectancyR: null,
    edgeSampleN: null,
    signalAgeBars: null,
    maxHoldDays: c.category === "SQUEEZE" ? 15 : c.category === "STUDS" ? 5 : 10,
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
    outcome: (preserved?.outcome ?? "PENDING") as "WIN" | "LOSS" | "TIME_EXIT" | "SKIP" | "PENDING",
    exitPrice: preserved?.exitPrice ?? null,
    outcomeNotes: preserved?.outcomeNotes ?? null,
    resolutionMethod: preserved?.resolutionMethod ?? null,
    resolutionQuality: preserved?.resolutionQuality ?? null,
    realizedR: preserved?.realizedR ?? null,
  });

  const earningsBatch = await fetchEarningsBatch(
    session.candidates.map((c) => c.ticker),
    reportDate,
  );

  // ---------- force re-import: preserve outcomes, replace everything else ----------
  if (existing.length > 0 && force) {
    const existingId = existing[0].id;
    const response = await db.transaction(async (tx) => {
      await lockScreenerSession(tx, session.date);
      // Re-read under the same lock used by outcome mutation; a pre-lock copy
      // could otherwise merge stale PENDING/null resolution fields.
      const existingCandidates = await tx
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existingId));
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
        })
        .where(eq(screenerSessionsTable.id, existingId))
        .returning();
      const incomingRows = mergeCandidateInputs(
        session.candidates.map((candidate) =>
          buildCandidateRow(updatedSession.id, candidate, earningsBatch.get(candidate.ticker) ?? UNKNOWN_EARNINGS),
        ),
        existingCandidates.map(({ id, ...candidate }) => candidate as any),
      );
      const { candidates: updatedCandidates, diff } = await synchronizeCandidates(tx, updatedSession.id, incomingRows);
      const aggregateSource = aggregateSessionSource(
        updatedSession.source,
        updatedCandidates.map((candidate) => candidate.signalSource),
      );
      await tx
        .update(screenerSessionsTable)
        .set({ lastImportDiff: diff, lastImportAt: new Date(), source: aggregateSource })
        .where(eq(screenerSessionsTable.id, updatedSession.id));
      await snapshotNewSessionTop3(
        tx,
        { id: updatedSession.id, date: updatedSession.date, source: aggregateSource },
        updatedCandidates,
      );
      return validatedImportResponse(tx, updatedSession.id, diff);
    });

    res.status(200).json(response);
    return;
  }

  // ---------- normal insert (no existing session) ----------
  const response = await db.transaction(async (tx) => {
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
        buildCandidateRow(insertedSession.id, c, earningsBatch.get(c.ticker) ?? UNKNOWN_EARNINGS),
      ),
    );
    const aggregateSource = aggregateSessionSource(
      insertedSession.source,
      insertedCandidates.map((candidate) => candidate.signalSource),
    );
    await tx
      .update(screenerSessionsTable)
      .set({ source: aggregateSource })
      .where(eq(screenerSessionsTable.id, insertedSession.id));
    await snapshotNewSessionTop3(
      tx,
      { id: insertedSession.id, date: insertedSession.date, source: aggregateSource },
      insertedCandidates,
    );
    return validatedImportResponse(tx, insertedSession.id);
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

  const existingCandidatesForDateCheck = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.sessionId, existingSession.id));
  const reimportIdentitySet = new Set(parsedSession.candidates.map((candidate) =>
    candidateIdentity({ ...candidate, market: "SE", signalSource: "manual" }),
  ));
  const sourceDateMismatch = existingCandidatesForDateCheck.find((candidate) =>
    candidate.signalDate != null &&
    reimportIdentitySet.has(candidateIdentity(candidate)) &&
    candidate.signalDate !== parsedSession.date,
  );
  if (sourceDateMismatch) {
    res.status(409).json({
      error: `Signal date mismatch for ${sourceDateMismatch.ticker}: stored ${sourceDateMismatch.signalDate}, incoming ${parsedSession.date}`,
    });
    return;
  }

  const reimportVolumes = await enrichVolMultiplier(
    parsedSession.candidates.map((candidate) => candidate.ticker),
    _yf,
    parsedSession.date,
  );
  let response: ReturnType<typeof parseSessionImportResponse>;
  try {
    response = await db.transaction(async (tx) => {
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
      const existingCandidates = await tx
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, updatedSession.id));
      const rows = parsedSession.candidates.map((candidate) => ({
        sessionId: updatedSession.id,
        signalDate: parsedSession.date,
        market: "SE" as const,
        signalSource: "manual" as const,
        origin: "manual" as const,
        category: candidate.category,
        rank: candidate.rank,
        ticker: candidate.ticker,
        price: candidate.price,
        rs3m: candidate.rs3m,
        perf1m: candidate.perf1m,
        rsi: candidate.rsi,
        pctB: candidate.pctB,
        atr: candidate.atr,
        volMultiplier: reimportVolumes.get(candidate.ticker)?.multiplier ?? 0,
        volumeAsOf: reimportVolumes.get(candidate.ticker)?.asOf ?? null,
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
      const { candidates: resultCandidates, diff } = await synchronizeCandidates(
        tx,
        updatedSession.id,
        mergeCandidateInputs(
          rows,
          existingCandidates.map(({ id, ...candidate }) => candidate),
        ),
      );
      const aggregateSource = aggregateSessionSource(
        updatedSession.source,
        resultCandidates.map((candidate) => candidate.signalSource),
      );
      await tx
        .update(screenerSessionsTable)
        .set({ lastImportDiff: diff, lastImportAt: new Date(), source: aggregateSource })
        .where(eq(screenerSessionsTable.id, updatedSession.id));
      await snapshotNewSessionTop3(
        tx,
        { id: updatedSession.id, date: updatedSession.date, source: aggregateSource },
        resultCandidates,
      );
      return validatedImportResponse(tx, updatedSession.id, diff);
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not synchronize candidates" });
    return;
  }

  res.json(response);
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
  const now = new Date();
  const liveSelection = buildTop3LiveSelection(
    session,
    candidates as Top3LiveCandidate[],
    now,
  );

  const selectionSnapshots = await db
    .select()
    .from(top3SelectionSnapshotsTable)
    .where(eq(top3SelectionSnapshotsTable.sessionId, session.id));
  const selectionByCandidate = new Map(selectionSnapshots.map((snapshot) => [snapshot.candidateId, snapshot]));

  const linkedIds = await fetchLinkedTradeIds(candidates.map((c) => c.id));
  const candidatesWithReview = candidates.map((candidate) => {
    const review = reviewCandidate(candidate, session.source ?? null);
    const officialSelection = selectionByCandidate.get(candidate.id);
    return {
      ...mapCandidate(candidate, linkedIds.has(candidate.id)),
      review,
      decision: decideCandidate(candidate, review, session.date),
      officialSelection: officialSelection ? {
        selected: officialSelection.selected,
        rank: officialSelection.rank,
        score: officialSelection.score,
        review: officialSelection.review,
        decision: officialSelection.decision,
        policyVersion: officialSelection.policyVersion,
        selectedAt: officialSelection.selectedAt,
        type: officialSelection.type,
        market: officialSelection.market,
        direction: officialSelection.direction,
        source: officialSelection.source,
      } : null,
    };
  });
  const sessionReview = reviewSession(
    candidatesWithReview.map((candidate) => candidate.review),
    session.marketRsi,
  );
  const snapshotStatus = describeTop3Snapshot(session, now);

  const parsed = GetSessionResponse.parse({
    id: session.id,
    date: session.date,
    source: session.source ?? null,
    createdAt: session.createdAt ?? null,
    lastImportAt: session.lastImportAt ?? null,
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
    top3SelectionSnapshot: snapshotStatus,
    top3LiveSelection: liveSelection,
  });

  // Append fields not in Zod schema — passed through directly
  res.json({
    ...parsed,
    candidates: candidatesWithReview,
    createdAt: session.createdAt ?? null,
    source: session.source ?? null,
    edgeRegime: session.edgeRegime ? (() => { try { return JSON.parse(session.edgeRegime!); } catch { return null; } })() : null,
    edgeExpectancy: session.edgeExpectancy ?? null,
    edgeWinRate: session.edgeWinRate ?? null,
    edgePF: session.edgePF ?? null,
    edgeN: session.edgeN ?? null,
    lastImportAt: session.lastImportAt ?? null,
    top3SelectionSnapshot: snapshotStatus,
    top3LiveSelection: liveSelection,
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
async function fetchLinkedTradeIds(candidateIds: number[], query = db): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await query
    .select({ sourceCandidateId: survivalTradesTable.sourceCandidateId })
    .from(survivalTradesTable)
    .where(inArray(survivalTradesTable.sourceCandidateId, candidateIds));
  return new Set(rows.map((r) => r.sourceCandidateId).filter((id): id is number => id != null));
}

/** Read the final snapshot metadata and validate before committing any writes. */
async function validatedImportResponse(
  tx: any,
  sessionId: number,
  diff?: import("../lib/candidateSynchronization").CandidateSyncDiff,
) {
  const [storedSession] = await tx.select().from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.id, sessionId));
  if (!storedSession) throw new Error("Imported session is missing");
  const candidates = await tx.select().from(candidatesTable)
    .where(eq(candidatesTable.sessionId, sessionId)) as (typeof candidatesTable.$inferSelect)[];
  const linkedIds = await fetchLinkedTradeIds(candidates.map((candidate) => candidate.id), tx);
  return parseSessionImportResponse(
    storedSession,
    candidates.map((candidate) => mapCandidate(candidate, linkedIds.has(candidate.id))),
    diff,
    candidates as Top3LiveCandidate[],
  );
}

function mapCandidate(c: {
  id: number;
  sessionId: number;
    signalDate: string | null;
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
  volumeAsOf: string | null;
  signalRsi: number | null;
  signalGapPct: number | null;
  edgeWinRate: number | null;
  edgeExpectancyR: number | null;
  edgeSampleN: number | null;
  signalAgeBars: number | null;
  maxHoldDays: number | null;
  distFrom20dH: number;
  gapWarning: number | null;
  earningsInDays: number | null;
  earningsKnowledge: "SIGNAL_TIME" | "UNKNOWN" | null;
  earningsObservedAt: Date | null;
  market: string | null;
  signalSource: "edgeai" | "telegram" | "manual" | "screener" | null;
  origin: "edgeai" | "legacy" | "manual" | null;
  direction: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  oneR: number;
  outcome: string;
  exitPrice: number | null;
  outcomeNotes: string | null;
  resolutionMethod: "MANUAL_EXIT" | "TARGET_HIT" | "STOP_HIT" | "TIME_EXIT" | null;
  resolutionQuality: "RECORDED_EXIT" | "ASSUMED_LEVEL" | "LEGACY_UNKNOWN" | null;
  realizedR: number | null;
  resolutionEntryPrice: number | null;
  resolutionStopPrice: number | null;
  resolutionDirection: "LONG" | "SHORT" | null;
  isTop3Pick?: boolean | null;
}, hasLinkedTrade = false) {
  return {
    id: c.id,
    sessionId: c.sessionId,
    signalDate: c.signalDate ?? null,
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
    volumeAsOf: c.volumeAsOf ?? null,
    signalRsi: c.signalRsi ?? null,
    signalGapPct: c.signalGapPct ?? null,
    edgeWinRate: c.edgeWinRate ?? null,
    edgeExpectancyR: c.edgeExpectancyR ?? null,
    edgeSampleN: c.edgeSampleN ?? null,
    signalAgeBars: c.signalAgeBars ?? null,
    maxHoldDays: c.maxHoldDays ?? null,
    distFrom20dH: c.distFrom20dH,
    gapWarning: c.gapWarning ?? null,
    earningsInDays: c.earningsInDays ?? null,
    // Pre-provenance rows are intentionally UNKNOWN even if they have a legacy
    // number: that number cannot establish what was known on signal day.
    earningsKnowledge: c.earningsKnowledge === "SIGNAL_TIME" ? "SIGNAL_TIME" : "UNKNOWN",
    earningsObservedAt: c.earningsObservedAt ?? null,
    market: c.market ?? "SE",
    signalSource: c.signalSource ?? null,
    origin: candidateOrigin(c.origin, c.signalSource),
    direction: c.direction,
    entryPrice: c.entryPrice,
    stopPrice: c.stopPrice,
    targetPrice: c.targetPrice,
    rr: c.rr,
    oneR: c.oneR,
    outcome: c.outcome,
    exitPrice: c.exitPrice ?? null,
    outcomeNotes: c.outcomeNotes ?? null,
    resolutionMethod: c.resolutionMethod ?? null,
    resolutionQuality: c.resolutionQuality ?? null,
    realizedR: c.realizedR ?? null,
     resolutionEntryPrice: c.resolutionEntryPrice ?? null,
     resolutionStopPrice: c.resolutionStopPrice ?? null,
     resolutionDirection: c.resolutionDirection ?? null,
    isTop3Pick: c.isTop3Pick ?? false,
    hasLinkedTrade,
  };
}

// PATCH /screener/candidates/:id/top3pick — toggle an annotation (max 3 per market/direction)
router.patch("/screener/candidates/:id/top3pick", async (req, res): Promise<void> => {
  const params = SetCandidateTop3AnnotationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsedBody = SetCandidateTop3AnnotationBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const id = params.data.id;
  const { isTop3Pick } = parsedBody.data;

  const result = await db.transaction(async (tx) => {
    const [beforeLock] = await tx.select().from(candidatesTable).where(eq(candidatesTable.id, id)).limit(1);
    if (!beforeLock) return { status: "missing" as const };
    const [session] = await tx
      .select({ date: screenerSessionsTable.date })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.id, beforeLock.sessionId));
    if (!session) return { status: "missing" as const };
    await lockScreenerSession(tx, session.date);

    // Serialize star annotations with import and outcome writers. They remain
    // annotations only; this endpoint never writes official snapshot rows.
    const [candidate] = await tx.select().from(candidatesTable).where(eq(candidatesTable.id, id)).limit(1);
    if (!candidate) return { status: "missing" as const };

    if (isTop3Pick) {
      const existing = await tx
        .select()
        .from(candidatesTable)
        .where(and(
          eq(candidatesTable.sessionId, candidate.sessionId),
          eq(candidatesTable.isTop3Pick, true),
        ));
      const sameMarketDirection = existing.filter((pick) =>
        pick.direction === candidate.direction && pick.market === candidate.market,
      );
      if (sameMarketDirection.length >= 3 && !sameMarketDirection.some((pick) => pick.id === id)) {
        const dirLabel = candidate.direction === "SHORT" ? "sälj-picks" : "köp-picks";
        return { status: "limit" as const, message: `Max 3 ${dirLabel} per market — ta bort en stjärna först` };
      }
    }

    const [updated] = await tx
      .update(candidatesTable)
      .set({ isTop3Pick })
      .where(eq(candidatesTable.id, id))
      .returning();
    return { status: "updated" as const, candidate: updated };
  });
  if (result.status === "missing") { res.status(404).json({ error: "Candidate not found" }); return; }
  if (result.status === "limit") { res.status(409).json({ error: result.message }); return; }
  res.json(SetCandidateTop3AnnotationResponse.parse({
    id: result.candidate.id,
    isTop3Pick: result.candidate.isTop3Pick,
  }));
});

export default router;

const _yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

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

/** Fetch Rule 7 data only when a Yahoo observation is contemporaneous with the signal. */
async function fetchEarningsBatch(
  tickers: string[],
  sessionDate: string,
): Promise<Map<string, EarningsObservation>> {
  if (sessionDate !== stockholmCalendarDate()) {
    return new Map(tickers.map((ticker) => [ticker, UNKNOWN_EARNINGS]));
  }
  const unique = [...new Set(tickers)];
  const results = await Promise.all(
    unique.map(async (t) => [t, await fetchEarningsAtSignalTime(t, sessionDate)] as const),
  );
  return new Map(results);
}

function stockholmCalendarDate(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Fetch relative volume for the report's completed day (not a live quote).
 * A failed verification leaves volume unavailable, not qualified by an
 * unverified report ratio or today's incomplete live quote.
 */
async function enrichVolMultiplier(
  tickers: string[],
  yf: InstanceType<typeof YahooFinance>,
  reportDate: string,
): Promise<Map<string, { multiplier: number; asOf: string }>> {
  const volumes = await fetchCompletedVolumeBatch(
    yf,
    tickers.map((ticker) => ({ ticker, market: "SE", asOfDate: reportDate })),
  );
  return new Map(tickers.flatMap((ticker) => {
    const result = volumes.get(`SE:${ticker}:${reportDate}`);
    return result ? [[ticker, result] as const] : [];
  }));
}

/** Current Yahoo data is signal-time evidence only after fetchEarningsBatch's date guard. */
async function fetchEarningsAtSignalTime(ticker: string, sessionDate: string): Promise<EarningsObservation> {
  const observedAt = new Date();
  try {
    const quote = await _yf.quote(resolveYahooTicker(ticker));
    const earningsTs: Date | null = (quote as any).earningsTimestamp ?? null;
    if (!earningsTs || !(earningsTs instanceof Date)) return UNKNOWN_EARNINGS;
    const sessionStart = new Date(`${sessionDate}T00:00:00.000Z`);
    return {
      earningsInDays: calendarDaysBetween(earningsTs, sessionStart),
      knowledge: "SIGNAL_TIME",
      observedAt,
    };
  } catch {
    return UNKNOWN_EARNINGS;
  }
}
