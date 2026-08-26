import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, candidatesTable, screenerSessionsTable, survivalTradesTable } from "@workspace/db";
import {
  ListCandidatesQueryParams,
  UpdateCandidateOutcomeParams,
  UpdateCandidateOutcomeBody,
  ListCandidatesResponse,
  UpdateCandidateOutcomeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
type ChallengeTradeInput = {
  date: string;
  ticker: string;
  strategy: string;
  direction: "LONG" | "SHORT";
  pnlKr: number;
  flag: "LAST" | "REFLEX";
  followedPlan: boolean;
  boughtBeforeReport?: boolean;
};

function parseChallengeTrade(value: unknown):
  | { success: true; data: ChallengeTradeInput }
  | { success: false; error: string } {
  if (!value || typeof value !== "object") {
    return { success: false, error: "challengeTrade must be an object" };
  }
  const input = value as Record<string, unknown>;
  const isDate = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date);
  const isText = (field: "ticker" | "strategy", max: number) =>
    typeof input[field] === "string" && input[field].trim().length > 0 && input[field].length <= max;
  if (
    !isDate ||
    !isText("ticker", 32) ||
    !isText("strategy", 120) ||
    (input.direction !== "LONG" && input.direction !== "SHORT") ||
    typeof input.pnlKr !== "number" ||
    !Number.isFinite(input.pnlKr) ||
    (input.flag !== "LAST" && input.flag !== "REFLEX") ||
    typeof input.followedPlan !== "boolean" ||
    (input.boughtBeforeReport !== undefined && typeof input.boughtBeforeReport !== "boolean")
  ) {
    return { success: false, error: "Invalid challengeTrade payload" };
  }
  return {
    success: true,
    data: {
      date: input.date as string,
      ticker: input.ticker as string,
      strategy: input.strategy as string,
      direction: input.direction as "LONG" | "SHORT",
      pnlKr: input.pnlKr as number,
      flag: input.flag as "LAST" | "REFLEX",
      followedPlan: input.followedPlan as boolean,
      boughtBeforeReport: input.boughtBeforeReport as boolean | undefined,
    },
  };
}

/** Fetch which of the given candidate ids have a linked Challenge Tracker trade. */
async function fetchLinkedTradeIds(candidateIds: number[]): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await db
    .select({ sourceCandidateId: survivalTradesTable.sourceCandidateId })
    .from(survivalTradesTable)
    .where(inArray(survivalTradesTable.sourceCandidateId, candidateIds));
  return new Set(rows.map((r) => r.sourceCandidateId).filter((id): id is number => id != null));
}

// GET /candidates
router.get("/candidates", async (req, res): Promise<void> => {
  const queryParams = ListCandidatesQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { category, outcome, direction } = queryParams.data;

  const conditions = [];
  if (category) conditions.push(eq(candidatesTable.category, category));
  if (outcome) conditions.push(eq(candidatesTable.outcome, outcome));
  if (direction) conditions.push(eq(candidatesTable.direction, direction));

  const rows = await db
    .select({
      id: candidatesTable.id,
      sessionId: candidatesTable.sessionId,
      category: candidatesTable.category,
      rank: candidatesTable.rank,
      ticker: candidatesTable.ticker,
      price: candidatesTable.price,
      rs3m: candidatesTable.rs3m,
      perf1m: candidatesTable.perf1m,
      rsi: candidatesTable.rsi,
      pctB: candidatesTable.pctB,
      atr: candidatesTable.atr,
      volMultiplier: candidatesTable.volMultiplier,
      distFrom20dH: candidatesTable.distFrom20dH,
      gapWarning: candidatesTable.gapWarning,
      direction: candidatesTable.direction,
      entryPrice: candidatesTable.entryPrice,
      stopPrice: candidatesTable.stopPrice,
      targetPrice: candidatesTable.targetPrice,
      rr: candidatesTable.rr,
      oneR: candidatesTable.oneR,
      outcome: candidatesTable.outcome,
      exitPrice: candidatesTable.exitPrice,
      outcomeNotes: candidatesTable.outcomeNotes,
      sessionDate: screenerSessionsTable.date,
    })
    .from(candidatesTable)
    .innerJoin(screenerSessionsTable, eq(candidatesTable.sessionId, screenerSessionsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(screenerSessionsTable.date, candidatesTable.category, candidatesTable.rank);

  const linkedIds = await fetchLinkedTradeIds(rows.map((r) => r.id));

  res.json(
    ListCandidatesResponse.parse(
      rows.map((r) => ({
        ...r,
        gapWarning: r.gapWarning ?? null,
        exitPrice: r.exitPrice ?? null,
        outcomeNotes: r.outcomeNotes ?? null,
        hasLinkedTrade: linkedIds.has(r.id),
      }))
    )
  );
});

// PATCH /candidates/:id/outcome
router.patch("/candidates/:id/outcome", async (req, res): Promise<void> => {
  const params = UpdateCandidateOutcomeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateCandidateOutcomeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const challengeInput =
    req.body?.challengeTrade === undefined
      ? null
      : parseChallengeTrade(req.body.challengeTrade);
  if (challengeInput && !challengeInput.success) {
    res.status(400).json({ error: challengeInput.error });
    return;
  }
  if (
    challengeInput &&
    body.data.outcome !== "WIN" &&
    body.data.outcome !== "LOSS"
  ) {
    res.status(400).json({ error: "A Challenge Tracker trade requires WIN or LOSS" });
    return;
  }
  // Explicit confirmation required to drop a linked Challenge Tracker trade —
  // financial history must never disappear as a side effect of an outcome edit.
  const removeChallengeTrade = req.body?.removeChallengeTrade === true;

  // Pre-check (read-only): if the outcome is moving away from WIN/LOSS and a
  // trade is already linked, require explicit confirmation before touching anything.
  const revertingOutcome = body.data.outcome !== "WIN" && body.data.outcome !== "LOSS";
  if (revertingOutcome && !removeChallengeTrade) {
    const [linkedTrade] = await db
      .select()
      .from(survivalTradesTable)
      .where(eq(survivalTradesTable.sourceCandidateId, params.data.id));
    if (linkedTrade) {
      res.status(409).json({
        error: `Detta utfall är kopplat till en loggad Challenge Tracker-trade (${linkedTrade.pnlKr} kr). Bekräfta borttagning för att fortsätta.`,
        existingChallengeTrade: linkedTrade,
      });
      return;
    }
  }

  const result = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, params.data.id));
    if (!candidate) return null;

    const [updated] = await tx
      .update(candidatesTable)
      .set({
        outcome: body.data.outcome,
        exitPrice: body.data.exitPrice ?? null,
        outcomeNotes: body.data.outcomeNotes ?? null,
      })
      .where(eq(candidatesTable.id, params.data.id))
      .returning();

    let hasLinkedTrade = false;

    if (challengeInput) {
      // Insert on first log, update in place on any later correction — a
      // resubmitted outcome must overwrite the old Challenge Tracker entry,
      // never sit silently next to it or get dropped.
      await tx
        .insert(survivalTradesTable)
        .values({
          ...challengeInput.data,
          sourceCandidateId: candidate.id,
          ticker: challengeInput.data.ticker.trim().toUpperCase(),
          boughtBeforeReport: challengeInput.data.boughtBeforeReport ?? false,
        })
        .onConflictDoUpdate({
          target: survivalTradesTable.sourceCandidateId,
          set: {
            date: challengeInput.data.date,
            ticker: challengeInput.data.ticker.trim().toUpperCase(),
            strategy: challengeInput.data.strategy,
            direction: challengeInput.data.direction,
            pnlKr: challengeInput.data.pnlKr,
            flag: challengeInput.data.flag,
            followedPlan: challengeInput.data.followedPlan,
            boughtBeforeReport: challengeInput.data.boughtBeforeReport ?? false,
          },
        });
      hasLinkedTrade = true;
    } else if (revertingOutcome && removeChallengeTrade) {
      const deleted = await tx
        .delete(survivalTradesTable)
        .where(eq(survivalTradesTable.sourceCandidateId, candidate.id))
        .returning({ id: survivalTradesTable.id });
      hasLinkedTrade = false;
      void deleted;
    } else {
      const [existingLink] = await tx
        .select({ id: survivalTradesTable.id })
        .from(survivalTradesTable)
        .where(eq(survivalTradesTable.sourceCandidateId, candidate.id));
      hasLinkedTrade = !!existingLink;
    }

    return { updated, hasLinkedTrade };
  });

  if (!result) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const { updated: result_, hasLinkedTrade } = result;

  res.json(
    UpdateCandidateOutcomeResponse.parse({
      id: result_.id,
      sessionId: result_.sessionId,
      category: result_.category,
      rank: result_.rank,
      ticker: result_.ticker,
      price: result_.price,
      rs3m: result_.rs3m,
      perf1m: result_.perf1m,
      rsi: result_.rsi,
      pctB: result_.pctB,
      atr: result_.atr,
      volMultiplier: result_.volMultiplier,
      distFrom20dH: result_.distFrom20dH,
      gapWarning: result_.gapWarning ?? null,
      direction: result_.direction,
      entryPrice: result_.entryPrice,
      stopPrice: result_.stopPrice,
      targetPrice: result_.targetPrice,
      rr: result_.rr,
      oneR: result_.oneR,
      outcome: result_.outcome,
      exitPrice: result_.exitPrice ?? null,
      outcomeNotes: result_.outcomeNotes ?? null,
      hasLinkedTrade,
    })
  );
});

export default router;
