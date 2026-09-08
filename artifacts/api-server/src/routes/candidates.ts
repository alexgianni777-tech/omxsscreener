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
import { lockScreenerSession } from "../lib/candidateSynchronization";
import { afterSessionWriteLock } from "../lib/sessionWriteSerialization";

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
  riskAllocationKr?: number;
};

type ResolutionMethod = "MANUAL_EXIT" | "TARGET_HIT" | "STOP_HIT";

/**
 * Resolve an outcome without inventing a price path. A manually recorded exit
 * always produces its actual R. Planned stop/target levels remain available
 * only as deliberate, auditable assumptions.
 */
function resolveOutcome(
  candidate: {
    entryPrice: number; stopPrice: number; targetPrice: number; direction: string;
    resolutionEntryPrice?: number | null; resolutionStopPrice?: number | null; resolutionDirection?: string | null;
  },
  input: {
    outcome: string; exitPrice?: number | null; resolutionMethod?: ResolutionMethod | null;
    actualExitConfirmed?: boolean;
  },
):
  | { success: true; exitPrice: number | null; realizedR: number | null; resolutionMethod: ResolutionMethod | null; resolutionQuality: "RECORDED_EXIT" | "ASSUMED_LEVEL" | null }
  | { success: false; error: string } {
  if (input.outcome !== "WIN" && input.outcome !== "LOSS") {
    return { success: true, exitPrice: null, realizedR: null, resolutionMethod: null, resolutionQuality: null };
  }

  const method = input.resolutionMethod ?? (input.exitPrice != null ? "MANUAL_EXIT" : null);
  if (!method) {
    return { success: false, error: "WIN eller LOSS kräver ett registrerat exit-pris eller en uttrycklig target/stop-anta­gande." };
  }
  if (method === "TARGET_HIT" && input.outcome !== "WIN") {
    return { success: false, error: "TARGET_HIT kan bara användas för WIN." };
  }
  if (method === "STOP_HIT" && input.outcome !== "LOSS") {
    return { success: false, error: "STOP_HIT kan bara användas för LOSS." };
  }

  const assumedPrice = method === "TARGET_HIT" ? candidate.targetPrice : method === "STOP_HIT" ? candidate.stopPrice : null;
  if (method !== "MANUAL_EXIT" && input.exitPrice != null && Math.abs(input.exitPrice - assumedPrice!) > 0.0001) {
    return { success: false, error: `${method} måste använda signalens ${method === "TARGET_HIT" ? "target" : "stop"}-pris.` };
  }
  if (method === "MANUAL_EXIT" && input.actualExitConfirmed !== true) {
    return { success: false, error: "MANUAL_EXIT kräver att ett faktiskt genomfört exit-fyllnad uttryckligen bekräftas. En Yahoo/live-kurs är inte ett registrerat exit." };
  }
  const exitPrice = assumedPrice ?? input.exitPrice;
  if (exitPrice == null || !Number.isFinite(exitPrice)) {
    return { success: false, error: "MANUAL_EXIT kräver ett giltigt faktiskt exit-pris." };
  }
  // Keep the first resolution's inputs immutable. Legacy rows have no
  // snapshot, so only an explicit new resolution may establish one; we never
  // infer historic execution provenance from their current signal fields.
  const entryPrice = candidate.resolutionEntryPrice ?? candidate.entryPrice;
  const stopPrice = candidate.resolutionStopPrice ?? candidate.stopPrice;
  const direction = candidate.resolutionDirection ?? candidate.direction;
  const oneR = Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(oneR) || oneR === 0) {
    return { success: false, error: "Kan inte beräkna R: entry och stop måste ha olika giltiga priser." };
  }
  const realizedR = direction === "LONG"
    ? (exitPrice - entryPrice) / oneR
    : (entryPrice - exitPrice) / oneR;
  if ((input.outcome === "WIN" && realizedR <= 0) || (input.outcome === "LOSS" && realizedR >= 0)) {
    return { success: false, error: `${input.outcome} stämmer inte med tecknet på beräknat realiserat R (${realizedR.toFixed(3)}R).` };
  }
  return {
    success: true,
    exitPrice,
    realizedR,
    resolutionMethod: method,
    resolutionQuality: method === "MANUAL_EXIT" ? "RECORDED_EXIT" : "ASSUMED_LEVEL",
  };
}

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
    || (input.riskAllocationKr !== undefined &&
      (typeof input.riskAllocationKr !== "number" || !Number.isFinite(input.riskAllocationKr) || input.riskAllocationKr <= 0))
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
      riskAllocationKr: input.riskAllocationKr as number | undefined,
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
      resolutionMethod: candidatesTable.resolutionMethod,
      resolutionQuality: candidatesTable.resolutionQuality,
      realizedR: candidatesTable.realizedR,
        resolutionEntryPrice: candidatesTable.resolutionEntryPrice,
        resolutionStopPrice: candidatesTable.resolutionStopPrice,
        resolutionDirection: candidatesTable.resolutionDirection,
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
        resolutionMethod: r.resolutionMethod ?? null,
        resolutionQuality: r.resolutionQuality ?? null,
        realizedR: r.realizedR ?? null,
        resolutionEntryPrice: r.resolutionEntryPrice ?? null,
        resolutionStopPrice: r.resolutionStopPrice ?? null,
        resolutionDirection: r.resolutionDirection ?? null,
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

  const revertingOutcome = body.data.outcome !== "WIN" && body.data.outcome !== "LOSS";

  // This lookup supplies only the advisory-lock key. Candidate, resolution and
  // link state are deliberately re-read after the lock has been acquired.
  const [locator] = await db
    .select({ date: screenerSessionsTable.date })
    .from(candidatesTable)
    .innerJoin(screenerSessionsTable, eq(candidatesTable.sessionId, screenerSessionsTable.id))
    .where(eq(candidatesTable.id, params.data.id));
  if (!locator) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const result = await db.transaction((tx) =>
    afterSessionWriteLock(
      () => lockScreenerSession(tx, locator.date),
      async () => {
    const [candidate] = await tx
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, params.data.id));
    if (!candidate) return null;

    const resolution = resolveOutcome(candidate, body.data);
    if (!resolution.success) {
      return { error: resolution.error };
    }

    const [existingLink] = await tx
      .select()
      .from(survivalTradesTable)
      .where(eq(survivalTradesTable.sourceCandidateId, candidate.id));
    if (existingLink && revertingOutcome && !removeChallengeTrade) {
      return {
        error: `Detta utfall är kopplat till en loggad Challenge Tracker-trade (${existingLink.pnlKr} kr). Bekräfta borttagning för att fortsätta.`,
        status: 409,
        existingChallengeTrade: existingLink,
      };
    }

    const [session] = await tx
      .select({ date: screenerSessionsTable.date })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.id, candidate.sessionId));
    if (!session) return { error: "Candidate session not found" };

    type SynchronizedChallengeTrade = ChallengeTradeInput & { riskAllocationKr: number };
    let synchronizedChallenge: SynchronizedChallengeTrade | null = null;
    if (!revertingOutcome && resolution.realizedR != null && challengeInput) {
      const submitted = challengeInput.data;
      const authoritativeTicker = candidate.ticker.trim().toUpperCase().replace(/\.ST$/i, "");
      const authoritativeDirection = candidate.resolutionDirection ?? candidate.direction;
      const submittedTicker = submitted.ticker.trim().toUpperCase().replace(/\.ST$/i, "");
      if (
        submittedTicker !== authoritativeTicker ||
        submitted.direction !== authoritativeDirection ||
        submitted.date !== session.date
      ) {
        return {
          error: "Challenge Tracker-identitet måste matcha kandidatens ticker, riktning och sessionsdatum.",
        };
      }
      if (
        (resolution.realizedR > 0 && submitted.pnlKr <= 0) ||
        (resolution.realizedR < 0 && submitted.pnlKr >= 0)
      ) {
        return { error: "Challenge Tracker P&L måste ha samma tecken som kandidatens R." };
      }
      const riskAllocationKr = submitted.riskAllocationKr ??
        Math.abs(submitted.pnlKr / resolution.realizedR);
      const pnlKr = Math.round(riskAllocationKr * resolution.realizedR);
      if (!Number.isFinite(riskAllocationKr) || riskAllocationKr <= 0 || pnlKr !== submitted.pnlKr) {
        return {
          error: `Challenge Tracker P&L måste vara ${pnlKr} kr för angiven risk och ${resolution.realizedR.toFixed(3)}R.`,
        };
      }
      synchronizedChallenge = {
        ...submitted,
        date: session.date,
        ticker: authoritativeTicker,
        direction: authoritativeDirection,
        pnlKr,
        riskAllocationKr,
      };
    } else if (!revertingOutcome && resolution.realizedR != null && existingLink) {
      const oldR = candidate.realizedR;
      const riskAllocationKr = existingLink.riskAllocationKr ??
        (oldR != null && Number.isFinite(oldR) && oldR !== 0
          ? Math.abs(existingLink.pnlKr / oldR)
          : null);
      if (riskAllocationKr == null || !Number.isFinite(riskAllocationKr) || riskAllocationKr <= 0) {
        return {
          error: "Den äldre kopplade traden saknar en säker riskallokering. Ange en uppdaterad Challenge Tracker-trade med riskAllocationKr.",
          status: 409,
          existingChallengeTrade: existingLink,
        };
      }
      synchronizedChallenge = {
        date: session.date,
        ticker: candidate.ticker.trim().toUpperCase().replace(/\.ST$/i, ""),
        strategy: existingLink.strategy,
        direction: candidate.resolutionDirection ?? candidate.direction,
        pnlKr: Math.round(riskAllocationKr * resolution.realizedR),
        riskAllocationKr,
        flag: existingLink.flag,
        followedPlan: existingLink.followedPlan,
        boughtBeforeReport: existingLink.boughtBeforeReport,
      };
    }

    const [updated] = await tx
      .update(candidatesTable)
      .set({
        outcome: body.data.outcome,
        exitPrice: resolution.exitPrice,
        outcomeNotes: body.data.outcomeNotes ?? null,
        resolutionMethod: resolution.resolutionMethod,
        resolutionQuality: resolution.resolutionQuality,
        realizedR: resolution.realizedR,
        resolutionEntryPrice: resolution.realizedR == null
          ? candidate.resolutionEntryPrice
          : (candidate.resolutionEntryPrice ?? candidate.entryPrice),
        resolutionStopPrice: resolution.realizedR == null
          ? candidate.resolutionStopPrice
          : (candidate.resolutionStopPrice ?? candidate.stopPrice),
        resolutionDirection: resolution.realizedR == null
          ? candidate.resolutionDirection
          : (candidate.resolutionDirection ?? candidate.direction),
      })
      .where(eq(candidatesTable.id, params.data.id))
      .returning();

    let hasLinkedTrade = false;

    if (synchronizedChallenge) {
      // Insert on first log, update in place on any later correction — a
      // resubmitted outcome must overwrite the old Challenge Tracker entry,
      // never sit silently next to it or get dropped.
      await tx
        .insert(survivalTradesTable)
        .values({
          date: synchronizedChallenge.date,
          ticker: synchronizedChallenge.ticker,
          strategy: synchronizedChallenge.strategy,
          direction: synchronizedChallenge.direction,
          pnlKr: synchronizedChallenge.pnlKr,
          riskAllocationKr: synchronizedChallenge.riskAllocationKr,
          flag: synchronizedChallenge.flag,
          followedPlan: synchronizedChallenge.followedPlan,
          sourceCandidateId: candidate.id,
          boughtBeforeReport: synchronizedChallenge.boughtBeforeReport ?? false,
        })
        .onConflictDoUpdate({
          target: survivalTradesTable.sourceCandidateId,
          set: {
            date: synchronizedChallenge.date,
            ticker: synchronizedChallenge.ticker,
            strategy: synchronizedChallenge.strategy,
            direction: synchronizedChallenge.direction,
            pnlKr: synchronizedChallenge.pnlKr,
            riskAllocationKr: synchronizedChallenge.riskAllocationKr,
            flag: synchronizedChallenge.flag,
            followedPlan: synchronizedChallenge.followedPlan,
            boughtBeforeReport: synchronizedChallenge.boughtBeforeReport ?? false,
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
      hasLinkedTrade = !!existingLink;
    }

        return { updated, hasLinkedTrade };
      },
    ),
  );

  if (!result) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  if ("error" in result) {
    res.status("status" in result && typeof result.status === "number" ? result.status : 400).json({
      error: result.error,
      ...("existingChallengeTrade" in result ? { existingChallengeTrade: result.existingChallengeTrade } : {}),
    });
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
      resolutionMethod: result_.resolutionMethod ?? null,
      resolutionQuality: result_.resolutionQuality ?? null,
      realizedR: result_.realizedR ?? null,
      resolutionEntryPrice: result_.resolutionEntryPrice ?? null,
      resolutionStopPrice: result_.resolutionStopPrice ?? null,
      resolutionDirection: result_.resolutionDirection ?? null,
      hasLinkedTrade,
    })
  );
});

export default router;
