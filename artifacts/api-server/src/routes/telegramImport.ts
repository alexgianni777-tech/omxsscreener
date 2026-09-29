import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";
import { parseScreenerText, ScreenerParseError } from "../lib/screenerParser";

const router: IRouter = Router();

function authorized(header: string | undefined): boolean {
  const secret = process.env.DASHBOARD_IMPORT_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;

  const supplied = header.slice("Bearer ".length);
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Machine-to-machine compatibility endpoint used by the legacy OMXS30
// GitHub Action. This route is intentionally mounted before requireAuth,
// but is protected by its own bearer secret.
router.post("/telegram-import", async (req, res): Promise<void> => {
  if (!process.env.DASHBOARD_IMPORT_SECRET) {
    res.status(503).json({ error: "DASHBOARD_IMPORT_SECRET is not configured" });
    return;
  }

  if (!authorized(req.get("authorization"))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  let parsed;
  try {
    parsed = parseScreenerText(text);
  } catch (err) {
    if (err instanceof ScreenerParseError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const result = await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: screenerSessionsTable.id,
        source: screenerSessionsTable.source,
      })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, parsed.date));

    let sessionId: number;
    if (existing.length > 0) {
      sessionId = existing[0].id;
    } else {
      const [inserted] = await tx
        .insert(screenerSessionsTable)
        .values({
          date: parsed.date,
          omxsValue: parsed.marketWeather.omxsValue,
          perf5d: parsed.marketWeather.perf5d,
          perf1m: parsed.marketWeather.perf1m,
          perf3m: parsed.marketWeather.perf3m,
          marketRsi: parsed.marketWeather.rsi,
          trendLabel: parsed.marketWeather.trendLabel,
          rawText: text,
          source: "legacy",
        })
        .returning({ id: screenerSessionsTable.id });
      sessionId = inserted.id;
    }

    const existingCandidates = await tx
      .select({
        ticker: candidatesTable.ticker,
        direction: candidatesTable.direction,
        category: candidatesTable.category,
        origin: candidatesTable.origin,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.sessionId, sessionId));

    const legacyKeys = new Set(
      existingCandidates
        .filter((candidate) => candidate.origin === "legacy")
        .map(
          (candidate) =>
            `${candidate.ticker}|${candidate.direction}|${candidate.category}`,
        ),
    );

    const additions = parsed.candidates.filter(
      (candidate) =>
        !legacyKeys.has(
          `${candidate.ticker}|${candidate.direction}|${candidate.category}`,
        ),
    );

    if (additions.length > 0) {
      await tx.insert(candidatesTable).values(
        additions.map((candidate) => ({
          sessionId,
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
          distFrom20dH: candidate.distFrom20dH,
          gapWarning: candidate.gapWarning ?? null,
          direction: candidate.direction,
          entryPrice: candidate.entryPrice,
          stopPrice: candidate.stopPrice,
          targetPrice: candidate.targetPrice,
          rr: candidate.rr,
          oneR: candidate.oneR,
          outcome: "PENDING" as const,
          exitPrice: null,
          outcomeNotes: null,
          origin: "legacy",
        })),
      );
    }

    return { sessionId, added: additions.length };
  });

  res.status(200).json({
    sessionId: result.sessionId,
    date: parsed.date,
    candidateCount: parsed.candidates.length,
    addedCandidateCount: result.added,
  });
});

export default router;
