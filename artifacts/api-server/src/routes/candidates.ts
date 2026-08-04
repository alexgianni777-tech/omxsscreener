import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, candidatesTable, screenerSessionsTable } from "@workspace/db";
import {
  ListCandidatesQueryParams,
  UpdateCandidateOutcomeParams,
  UpdateCandidateOutcomeBody,
  ListCandidatesResponse,
  UpdateCandidateOutcomeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

  const [updated] = await db
    .update(candidatesTable)
    .set({
      outcome: body.data.outcome,
      exitPrice: body.data.exitPrice ?? undefined,
      outcomeNotes: body.data.outcomeNotes ?? undefined,
    })
    .where(eq(candidatesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  res.json(
    UpdateCandidateOutcomeResponse.parse({
      id: updated.id,
      sessionId: updated.sessionId,
      category: updated.category,
      rank: updated.rank,
      ticker: updated.ticker,
      price: updated.price,
      rs3m: updated.rs3m,
      perf1m: updated.perf1m,
      rsi: updated.rsi,
      pctB: updated.pctB,
      atr: updated.atr,
      volMultiplier: updated.volMultiplier,
      distFrom20dH: updated.distFrom20dH,
      gapWarning: updated.gapWarning ?? null,
      direction: updated.direction,
      entryPrice: updated.entryPrice,
      stopPrice: updated.stopPrice,
      targetPrice: updated.targetPrice,
      rr: updated.rr,
      oneR: updated.oneR,
      outcome: updated.outcome,
      exitPrice: updated.exitPrice ?? null,
      outcomeNotes: updated.outcomeNotes ?? null,
    })
  );
});

export default router;
