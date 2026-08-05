/**
 * POST /screener/sessions/import-from-edgeai
 *
 * Fetches EdgeAI's public data.json, extracts SE market setups,
 * and creates a screener session — no copy-paste needed.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";

const router: IRouter = Router();

const EDGEAI_URL = "https://alexgianni777-tech.github.io/edgeai/public/data.json";

function mapSetupToCategory(
  dir: string,
  setupName: string,
): "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST" {
  if (dir === "short") return "WEAKEST";
  const n = setupName.toLowerCase();
  if (n.includes("squeeze") || n.includes("bollinger") || n.includes("reversion") || n.includes("mean"))
    return "SQUEEZE";
  if (n.includes("pullback") || n.includes("stud") || n.includes("reversal"))
    return "STUDS";
  return "MOMENTUM"; // breakout, momentum, flag, trend, default
}

router.post(
  "/screener/sessions/import-from-edgeai",
  async (req, res): Promise<void> => {
    // 1. Fetch latest EdgeAI data
    let edgeData: any;
    try {
      const resp = await fetch(EDGEAI_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        res.status(502).json({ error: `EdgeAI fetch failed: ${resp.status}` });
        return;
      }
      edgeData = await resp.json();
    } catch (err: any) {
      res.status(502).json({ error: `Could not reach EdgeAI: ${err.message}` });
      return;
    }

    const se = edgeData?.markets?.SE;
    if (!se) {
      res.status(502).json({ error: "EdgeAI response missing SE market data" });
      return;
    }

    const setups: any[] = se.setups ?? [];
    if (setups.length === 0) {
      res.status(422).json({
        error: "EdgeAI has no SE setups today — screener may not have run yet.",
        generatedAt: edgeData.generatedAt,
      });
      return;
    }

    // 2. Derive session date from generatedAt
    const sessionDate = (edgeData.generatedAt as string).slice(0, 10);

    // 3. Check for existing session (respect force flag)
    const force = req.body?.force === true;
    const existing = await db
      .select({ id: screenerSessionsTable.id })
      .from(screenerSessionsTable)
      .where(eq(screenerSessionsTable.date, sessionDate));

    if (existing.length > 0 && !force) {
      // Return same 409 shape as the regular import endpoint
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
        error: `A session for ${sessionDate} already exists`,
        sessionId: existingId,
        date: sessionDate,
        affectedOutcomes,
      });
      return;
    }

    // 4. Map setups → candidates, group by category for ranking
    const rankCounter: Record<string, number> = {};

    const mappedSetups = setups.map((s: any) => {
      const category = mapSetupToCategory(s.dir, s.setup ?? "");
      rankCounter[category] = (rankCounter[category] ?? 0) + 1;
      const direction = s.dir === "short" ? "SHORT" : "LONG";
      const entry = Number(s.entry ?? 0);
      const stop = Number(s.stop ?? 0);
      const target = Number(s.target ?? 0);
      const oneR = Math.abs(entry - stop);
      return {
        category,
        rank: rankCounter[category],
        ticker: String(s.ticker ?? "").toUpperCase(),
        price: entry,
        rs3m: Number(s.rs ?? 0),
        perf1m: 0,
        rsi: 50, // not provided by EdgeAI
        pctB: 0,
        atr: oneR, // best proxy available
        volMultiplier: 1,
        distFrom20dH: 0,
        gapWarning: null,
        direction,
        entryPrice: entry,
        stopPrice: stop,
        targetPrice: target,
        rr: Number(s.rr ?? 0),
        oneR,
        outcome: "PENDING" as const,
      };
    });

    // 5. Handle force re-import: preserve existing outcomes
    let sessionId: number;

    if (existing.length > 0 && force) {
      const existingId = existing[0].id;
      const existingCands = await db
        .select({
          ticker: candidatesTable.ticker,
          outcome: candidatesTable.outcome,
          exitPrice: candidatesTable.exitPrice,
          outcomeNotes: candidatesTable.outcomeNotes,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.sessionId, existingId));

      const outcomeMap = new Map(
        existingCands
          .filter((c) => c.outcome !== "PENDING")
          .map((c) => [c.ticker, c]),
      );

      await db.delete(candidatesTable).where(eq(candidatesTable.sessionId, existingId));

      const [updated] = await db
        .update(screenerSessionsTable)
        .set({
          trendLabel: se.regime?.label ?? "n/a",
          rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt}`,
          omxsValue: 0,
          perf5d: 0,
          perf1m: 0,
          perf3m: 0,
          marketRsi: 0,
        })
        .where(eq(screenerSessionsTable.id, existingId))
        .returning();

      await db.insert(candidatesTable).values(
        mappedSetups.map((c) => {
          const prev = outcomeMap.get(c.ticker);
          return {
            ...c,
            sessionId: updated.id,
            outcome: prev?.outcome ?? "PENDING",
            exitPrice: prev?.exitPrice ?? null,
            outcomeNotes: prev?.outcomeNotes ?? null,
          } as any;
        }),
      );

      sessionId = updated.id;
    } else {
      // Fresh insert
      const [inserted] = await db
        .insert(screenerSessionsTable)
        .values({
          date: sessionDate,
          omxsValue: 0,
          perf5d: 0,
          perf1m: 0,
          perf3m: 0,
          marketRsi: 0,
          trendLabel: se.regime?.label ?? "n/a",
          rawText: `EdgeAI import — generatedAt ${edgeData.generatedAt}`,
        })
        .returning();

      await db.insert(candidatesTable).values(
        mappedSetups.map((c) => ({ ...c, sessionId: inserted.id } as any)),
      );

      sessionId = inserted.id;
    }

    res.status(existing.length > 0 && force ? 200 : 201).json({
      id: sessionId,
      date: sessionDate,
      setupCount: mappedSetups.length,
      generatedAt: edgeData.generatedAt,
      regime: se.regime,
    });
  },
);

export default router;
