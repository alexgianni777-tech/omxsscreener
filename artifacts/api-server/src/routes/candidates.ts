import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
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

  res.json(
    ListCandidatesResponse.parse(
      rows.map((r) => ({
        ...r,
        gapWarning: r.gapWarning ?? null,
        exitPrice: r.exitPrice ?? null,
        outcomeNotes: r.outcomeNotes ?? null,
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

    if (challengeInput) {
      await tx
        .insert(survivalTradesTable)
        .values({
          ...challengeInput.data,
          sourceCandidateId: candidate.id,
          ticker: challengeInput.data.ticker.trim().toUpperCase(),
          boughtBeforeReport: challengeInput.data.boughtBeforeReport ?? false,
        })
        .onConflictDoNothing({
          target: survivalTradesTable.sourceCandidateId,
        });
    }

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  res.json(
    UpdateCandidateOutcomeResponse.parse({
      id: result.id,
      sessionId: result.sessionId,
      category: result.category,
      rank: result.rank,
      ticker: result.ticker,
      price: result.price,
      rs3m: result.rs3m,
      perf1m: result.perf1m,
      rsi: result.rsi,
      pctB: result.pctB,
      atr: result.atr,
      volMultiplier: result.volMultiplier,
      distFrom20dH: result.distFrom20dH,
      gapWarning: result.gapWarning ?? null,
      direction: result.direction,
      entryPrice: result.entryPrice,
      stopPrice: result.stopPrice,
      targetPrice: result.targetPrice,
      rr: result.rr,
      oneR: result.oneR,
      outcome: result.outcome,
      exitPrice: result.exitPrice ?? null,
      outcomeNotes: result.outcomeNotes ?? null,
    })
  );
});

export default router;
