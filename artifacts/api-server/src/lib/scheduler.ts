/**
 * Daily EdgeAI auto-import scheduler.
 *
 * Logic:
 *  - Every 5 minutes, check if today is a weekday AND there is no session yet.
 *  - If conditions met AND it's past 06:15 UTC, trigger EdgeAI import.
 *  - This gracefully handles server restarts: if the server came up after
 *    06:15 and no session exists, it imports immediately on the first tick.
 */
import { db, screenerSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const EDGEAI_URL = "https://alexgianni777-tech.github.io/edgeai/public/data.json";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EARLIEST_HOUR_UTC = 6; // don't import before 06:00 UTC

// In-memory status — reset on server restart
export let schedulerStatus: {
  lastChecked: string | null;
  lastImported: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
} = {
  lastChecked: null,
  lastImported: null,
  lastError: null,
  nextCheckAt: null,
};

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5; // Mon–Fri
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sessionExistsForDate(date: string): Promise<boolean> {
  const rows = await db
    .select({ id: screenerSessionsTable.id })
    .from(screenerSessionsTable)
    .where(eq(screenerSessionsTable.date, date));
  return rows.length > 0;
}

async function runImport(date: string): Promise<void> {
  logger.info({ date }, "[scheduler] Fetching EdgeAI data.json");

  const resp = await fetch(EDGEAI_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`EdgeAI fetch HTTP ${resp.status}`);

  const edgeData: any = await resp.json();
  const se = edgeData?.markets?.SE;
  const setups: any[] = se?.setups ?? [];

  if (setups.length === 0) {
    logger.info({ date, generatedAt: edgeData.generatedAt }, "[scheduler] No SE setups today — skipping");
    return;
  }

  // Delegate to the edgeai route logic by calling it directly
  // (avoids duplicating HTTP round-trip; we reuse the DB insert pattern)
  const { candidatesTable } = await import("@workspace/db");

  function mapCategory(dir: string, setupName: string): "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST" {
    if (dir === "short") return "WEAKEST";
    const n = setupName.toLowerCase();
    if (n.includes("squeeze") || n.includes("bollinger") || n.includes("reversion")) return "SQUEEZE";
    if (n.includes("pullback") || n.includes("stud") || n.includes("reversal")) return "STUDS";
    return "MOMENTUM";
  }

  const rankCounter: Record<string, number> = {};
  const mapped = setups.map((s: any) => {
    const category = mapCategory(s.dir, s.setup ?? "");
    rankCounter[category] = (rankCounter[category] ?? 0) + 1;
    const direction = s.dir === "short" ? "SHORT" : "LONG";
    const entry = Number(s.entry ?? 0);
    const stop = Number(s.stop ?? 0);
    const oneR = Math.abs(entry - stop);
    return {
      category, rank: rankCounter[category], ticker: String(s.ticker ?? "").toUpperCase(),
      price: entry, rs3m: Number(s.rs ?? 0), perf1m: 0, rsi: 50, pctB: 0, atr: oneR,
      volMultiplier: 1, distFrom20dH: 0, gapWarning: null, direction,
      entryPrice: entry, stopPrice: stop, targetPrice: Number(s.target ?? 0),
      rr: Number(s.rr ?? 0), oneR, outcome: "PENDING" as const,
    };
  });

  const [inserted] = await db
    .insert(screenerSessionsTable)
    .values({
      date,
      omxsValue: 0, perf5d: 0, perf1m: 0, perf3m: 0, marketRsi: 0,
      trendLabel: se.regime?.label ?? "n/a",
      rawText: `EdgeAI auto-import — generatedAt ${edgeData.generatedAt}`,
      source: "edgeai",
      edgeRegime: JSON.stringify(se.regime ?? {}),
      edgeExpectancy: se.edge?.expectancyR ?? null,
      edgeWinRate: se.edge?.winRate ?? null,
      edgePF: se.edge?.profitFactor ?? null,
      edgeN: se.edge?.n ?? null,
    })
    .returning();

  await db.insert(candidatesTable).values(
    mapped.map((c) => ({ ...c, sessionId: inserted.id } as any)),
  );

  logger.info({ date, sessionId: inserted.id, setups: mapped.length }, "[scheduler] Auto-import complete");
}

async function tick() {
  const now = new Date();
  schedulerStatus.lastChecked = now.toISOString();

  if (!isWeekday(now)) return;
  if (now.getUTCHours() < EARLIEST_HOUR_UTC) return;

  const today = todayUtc();
  if (await sessionExistsForDate(today)) return;

  logger.info({ today }, "[scheduler] No session found, auto-importing from EdgeAI");

  try {
    await runImport(today);
    schedulerStatus.lastImported = today;
    schedulerStatus.lastError = null;
  } catch (err: any) {
    schedulerStatus.lastError = err.message ?? String(err);
    logger.warn({ err: err.message }, "[scheduler] Auto-import failed");
  }
}

export function startScheduler() {
  // Run once on startup (with a short delay to let DB connect)
  setTimeout(() => tick(), 10_000);
  // Then every 5 minutes
  const interval = setInterval(tick, CHECK_INTERVAL_MS);

  const nextCheck = new Date(Date.now() + CHECK_INTERVAL_MS);
  schedulerStatus.nextCheckAt = nextCheck.toISOString();

  logger.info("[scheduler] Started — checking EdgeAI every 5 minutes on weekdays after 06:00 UTC");
  return interval;
}
