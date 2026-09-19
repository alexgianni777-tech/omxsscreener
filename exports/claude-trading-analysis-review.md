# Kodunderlag för oberoende granskning av OMXS30 / EdgeAI-screenern

## Uppdrag till Claude

Granska koden nedan som både senior systemutvecklare och kvantitativ tradinganalytiker. Målet är inte att kommentera kodstil i första hand, utan att bedöma om analysen, rankningen, riskhanteringen och resultatmätningen ger en trovärdig grund för verklig handel.

Var skeptisk och skilj tydligt mellan:

1. korrekt fungerande kod,
2. rimliga men obevisade handelsantaganden,
3. statistiskt verifierad edge.

Bedöm särskilt:

- look-ahead-, survivorship-, urvals- och censureringsbias,
- om Top 3-rankningen verkligen mäter förväntad framtida R,
- om EdgeAI och Telegram blandar fält med olika betydelser,
- sample size, osäkerhet, shrinkage och konfidensintervall,
- SE kontra US samt long kontra short,
- marknadsregim, volym, RSI, momentum, rapportfilter och signalålder,
- stop, target, R:R, faktisk exit och realiserad R,
- spread, slippage och andra handelskostnader,
- om historiska picks och beslutsunderlag är oföränderliga,
- om öppna eller oregistrerade utfall kan snedvrida statistiken.

Leverera svaret i denna ordning:

1. Samlad bedömning.
2. Kritiska fel som kan visa missvisande resultat.
3. Svagheter i tradinglogiken.
4. Det som redan är bra.
5. Fem högst prioriterade förbättringar.
6. Ett konkret förslag på en bättre rankingformel.
7. Vilka fält som bör sparas oföränderligt vid signaltillfället.
8. En testplan för att avgöra om modellen har edge out-of-sample efter kostnader.

## Viktig systemkontext

- Kandidater kan komma från EdgeAI, Telegram eller manuell import.
- En session kan innehålla flera källor och både svenska och amerikanska kandidater.
- EdgeAI använder vissa äldre databaskolumner för andra semantiska värden: win rate, expectancy, sample size och signalålder.
- Faktiska avslut kan lagra realiserad R och låsta entry/stop/riktningsvärden.
- Regel 7 blockerar rapport inom fem dagar endast när rapportinformationen är verifierad från signaltillfället.
- Detta dokument innehåller de centrala analysfilerna, inte autentisering, UI eller hela importinfrastrukturen.

---

## Fil: artifacts/api-server/src/lib/screeningReview.ts

```typescript
export type ReviewStatus = "APPROVED" | "WARN" | "BLOCKED";

export type CandidateReviewInput = {
  category: string;
  direction: string;
  rs3m: number;
  perf1m: number;
  rsi: number;
  signalRsi: number | null;
  signalGapPct: number | null;
  volMultiplier: number;
  earningsInDays: number | null;
  earningsKnowledge: "SIGNAL_TIME" | "UNKNOWN" | null;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  signalSource?: string | null;
};

export type SignalReview = {
  status: ReviewStatus;
  reasons: string[];
};

export type CandidateDecisionStatus = "TRADEABLE" | "WAIT" | "BLOCKED" | "INVALID" | "STALE";

export type CandidateDecision = {
  status: CandidateDecisionStatus;
  reasons: string[];
};

function statusFor(reasons: string[], blockers: string[]): ReviewStatus {
  if (blockers.length > 0) return "BLOCKED";
  return reasons.length > 0 ? "WARN" : "APPROVED";
}

export function reviewCandidate(
  candidate: CandidateReviewInput,
  source: string | null,
): SignalReview {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const isShort = candidate.direction === "SHORT";
  const isEdgeAi = (candidate.signalSource ?? source) === "edgeai";

  if (!Number.isFinite(candidate.volMultiplier) || candidate.volMultiplier <= 0) {
    blockers.push("Volymdata saknas — ingen kvalificerad trade.");
  } else if (candidate.volMultiplier < 0.2) {
    warnings.push(`Låg relativ volym (${candidate.volMultiplier.toFixed(1)}x).`);
  }

  if (
    !Number.isFinite(candidate.entryPrice) ||
    !Number.isFinite(candidate.stopPrice) ||
    !Number.isFinite(candidate.targetPrice) ||
    candidate.entryPrice <= 0 ||
    candidate.stopPrice <= 0 ||
    candidate.targetPrice <= 0
  ) {
    blockers.push("Ofullständig entry-, stop- eller targetdata.");
  } else if (
    (!isShort && (candidate.stopPrice >= candidate.entryPrice || candidate.targetPrice <= candidate.entryPrice)) ||
    (isShort && (candidate.stopPrice <= candidate.entryPrice || candidate.targetPrice >= candidate.entryPrice))
  ) {
    blockers.push("Tradeplanens riktning stämmer inte med entry, stop och target.");
  }

  if (candidate.rr < 1.2) blockers.push(`R:R ${candidate.rr.toFixed(2)} är under miniminivån 1,2.`);
  if (candidate.earningsKnowledge !== "SIGNAL_TIME") {
    warnings.push("Regel 7 ej bedömbar: rapportkalender saknar verifierad signal-tidsobservation.");
  } else if (candidate.earningsInDays != null && candidate.earningsInDays >= 0 && candidate.earningsInDays <= 5) {
    blockers.push(`Rapport inom ${candidate.earningsInDays} dagar — exkluderas enligt Regel 7.`);
  }

  const targetDistance = candidate.entryPrice > 0 && candidate.targetPrice > 0
    ? Math.abs((candidate.targetPrice - candidate.entryPrice) / candidate.entryPrice) * 100
    : 0;
  if (targetDistance > 10) warnings.push(`Target ligger ${targetDistance.toFixed(1)}% från entry.`);

  if (!isEdgeAi && candidate.category === "MOMENTUM" && !isShort) {
    if (candidate.perf1m <= 0) blockers.push("Momentum saknar positiv 1-månadsutveckling.");
    if (candidate.rs3m <= 0) blockers.push("Momentum saknar positiv relativ styrka.");
  }

  if (isShort) {
    const shortRsi = isEdgeAi ? candidate.signalRsi : candidate.rsi;
    if (shortRsi != null && shortRsi > 0 && shortRsi < 35) {
      blockers.push(`Short är översåld (RSI ${shortRsi.toFixed(1)}) och stoppas.`);
    }
    if (candidate.signalGapPct != null && candidate.signalGapPct >= 2.5) {
      blockers.push(`Short har uppgap på ${candidate.signalGapPct.toFixed(1)}% och stoppas.`);
    }
    if (!isEdgeAi && candidate.rs3m > 0) {
      blockers.push("Short saknar negativ relativ styrka.");
    }
  }

  const reasons = [...blockers, ...warnings];
  return { status: statusFor(warnings, blockers), reasons };
}

/**
 * A trader-facing decision derived from the already persisted signal and its
 * review.  This deliberately does not infer whether a Yahoo request succeeded:
 * that provenance is not stored with legacy candidates.  It only reports
 * missing/invalid values that are actually present in the candidate record.
 */
export function decideCandidate(
  candidate: CandidateReviewInput & { price: number },
  review: SignalReview,
  sessionDate: string,
  now = new Date(),
): CandidateDecision {
  const invalid: string[] = [];
  if (!Number.isFinite(candidate.price) || candidate.price <= 0) {
    invalid.push("Screenad kurs saknas eller är ogiltig.");
  }
  if (!Number.isFinite(candidate.volMultiplier) || candidate.volMultiplier <= 0) {
    invalid.push("Volymdata saknas eller är ogiltig.");
  }
  if (!Number.isFinite(candidate.rsi) || candidate.rsi < 0) {
    invalid.push("RSI-data saknas eller är ogiltig.");
  }
  if (!Number.isFinite(candidate.rr) || candidate.rr <= 0) {
    invalid.push("R:R saknas eller är ogiltig.");
  }
  if (
    !Number.isFinite(candidate.entryPrice) || candidate.entryPrice <= 0 ||
    !Number.isFinite(candidate.stopPrice) || candidate.stopPrice <= 0 ||
    !Number.isFinite(candidate.targetPrice) || candidate.targetPrice <= 0
  ) {
    invalid.push("Entry-, stop- eller targetdata saknas eller är ogiltig.");
  }
  if (invalid.length > 0) return { status: "INVALID", reasons: [...invalid, ...review.reasons] };

  // Compare date-only values in UTC to avoid a browser/server timezone turning
  // today's snapshot into yesterday's.
  const today = now.toISOString().slice(0, 10);
  if (sessionDate < today) {
    return {
      status: "STALE",
      reasons: [`Signalen är från ${sessionDate}; kontrollera en ny snapshot och live-pris före trade.`, ...review.reasons],
    };
  }
  if (review.status === "BLOCKED") return { status: "BLOCKED", reasons: review.reasons };
  if (review.status === "WARN") return { status: "WAIT", reasons: review.reasons };
  return {
    status: "TRADEABLE",
    reasons: ["Screeningsreglerna är godkända för dagens signal."],
  };
}

export function reviewSession(
  candidateReviews: SignalReview[],
  marketRsi: number,
): SignalReview & { tradableCount: number } {
  const tradableCount = candidateReviews.filter((review) => review.status !== "BLOCKED").length;
  const reasons: string[] = [];
  if (!Number.isFinite(marketRsi) || marketRsi <= 0) {
    reasons.push("Marknads-RSI saknas — marknadsregimen är inte fullt verifierad.");
  }
  if (tradableCount === 0) reasons.unshift("Ingen kvalificerad trade idag.");

  return {
    status: tradableCount === 0 ? "BLOCKED" : reasons.length > 0 ? "WARN" : "APPROVED",
    reasons,
    tradableCount,
  };
}
```

---

## Fil: artifacts/api-server/src/lib/edgeAiMapping.ts

```typescript
/**
 * Single source of truth for mapping a raw EdgeAI setup object to a candidate
 * row's fields. Used by BOTH the scheduled auto-import (scheduler.ts) and the
 * manual "Importera från EdgeAI" endpoint (routes/edgeai.ts).
 *
 * IMPORTANT: never re-implement this mapping in either caller. A rounding/type
 * mismatch between two separate copies of this logic has already caused a real
 * incident: one copy rounded `rsi` before insert (the column is an integer)
 * while the other didn't, so the daily auto-import silently rolled back its
 * transaction whenever a fractional value appeared — invisible until someone
 * checked whether a session existed for that date. Keep this the only copy.
 */
import { calculateOpeningGapPct, calculateWilderRsi } from "./marketIndicators";
import { edgeAiDirection } from "./edgeAiSource";

export type EdgeAiCategory = "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST";
export type EdgeAiMarket = "SE" | "US";

export function mapEdgeAiCategory(
  direction: "LONG" | "SHORT",
  setupName: string,
): EdgeAiCategory {
  if (direction === "SHORT") return "WEAKEST";
  const n = setupName.toLowerCase();
  if (n.includes("squeeze") || n.includes("bollinger") || n.includes("reversion") || n.includes("mean"))
    return "SQUEEZE";
  if (n.includes("pullback") || n.includes("stud") || n.includes("reversal"))
    return "STUDS";
  return "MOMENTUM"; // breakout, momentum, flag, trend, default
}

/**
 * Maps one raw EdgeAI setup to a candidate row. `rankCounter` is a caller-owned
 * dict used to assign a 1-based rank within each `${market}:${category}` bucket
 * — pass a fresh dict per session, and the same dict across markets is safe
 * since the key already includes the market.
 */
export function mapEdgeAiSetup(
  s: any,
  market: EdgeAiMarket,
  rankCounter: Record<string, number>,
) {
  const direction = edgeAiDirection(s.dir);
  const category = mapEdgeAiCategory(direction, s.setup ?? "");
  const rankKey = `${market}:${category}`;
  rankCounter[rankKey] = (rankCounter[rankKey] ?? 0) + 1;

  const entry = Number(s.entry ?? 0);
  const stop = Number(s.stop ?? 0);
  const oneR = Math.abs(entry - stop);
  // Use EdgeAI's own calibrated target — it reflects the system's actual back-tested level.
  // Forcing a fixed R:R would reduce win rate below the system's calibration.
  const targetPrice = Number(s.target ?? 0);
  const rr = Number(s.rr ?? 0);
  // Strip .ST so resolveYahooTicker can re-add it correctly for SE stocks;
  // US tickers have no .ST so this is a no-op for them.
  const ticker = String(s.ticker ?? "").replace(/\.ST$/i, "").toUpperCase();
  // barsAgo: how many bars (trading days) ago the signal was first triggered
  const barsAgo = Number(s.barsAgo ?? 0);
  const chart = Array.isArray(s.chart) ? s.chart : [];
  const signalRsi = calculateWilderRsi(chart.map((bar: any) => Number(bar?.c)));
  const signalGapPct = calculateOpeningGapPct(chart);

  return {
    market,
    category,
    rank: rankCounter[rankKey],
    ticker,
    price: entry,
    rs3m: Number(s.rs ?? 0),
    // Normalize to decimal 0–1 (EdgeAI may send integer % like 51).
    perf1m: (() => { const wr = Number(s.edge?.winRate ?? 0); return wr > 1 ? wr / 100 : wr; })(),
    // `rsi` is a legacy integer display field mapped from EdgeAI's expectancy —
    // the column is a Postgres integer, so this MUST be rounded before insert.
    rsi: Math.round(Number(s.edge?.expectancyR ?? 0) * 100),
    pctB: Number(s.edge?.sample ?? 0), // store N (sample size)
    atr: oneR,
    volMultiplier: 0, // filled in by live Yahoo Finance fetch by the caller
    earningsInDays: null as number | null,
    earningsKnowledge: "UNKNOWN" as "SIGNAL_TIME" | "UNKNOWN",
    earningsObservedAt: null as Date | null,
    distFrom20dH: barsAgo, // store signal age in trading days
    signalRsi,
    signalGapPct,
    gapWarning: signalGapPct != null && Math.abs(signalGapPct) >= 2.5 ? signalGapPct : null,
    direction,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice,
    rr,
    oneR,
    outcome: "PENDING" as const,
  };
}

```

---

## Fil: artifacts/api-server/src/lib/marketIndicators.ts

```typescript
export type PriceBar = {
  o?: number;
  c?: number;
};

/**
 * Wilder RSI(14) with an extended warm-up. The extra bars avoid the
 * window-roll artifact where RSI moves in the opposite direction to price.
 */
export function calculateWilderRsi(closes: number[], period = 14): number | null {
  const valid = closes.filter((close) => Number.isFinite(close) && close > 0);
  if (valid.length < period * 2 + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index++) {
    const delta = valid[index] - valid[index - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < valid.length; index++) {
    const delta = valid[index] - valid[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return Math.round((100 - 100 / (1 + relativeStrength)) * 10) / 10;
}

/** Opening gap from the previous close to the latest bar's open. */
export function calculateOpeningGapPct(chart: PriceBar[] | undefined): number | null {
  if (!chart || chart.length < 2) return null;
  const previousClose = Number(chart.at(-2)?.c);
  const latestOpen = Number(chart.at(-1)?.o);
  if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(latestOpen)) {
    return null;
  }
  return Math.round(((latestOpen - previousClose) / previousClose) * 1000) / 1000;
}

export function volumeMultiplierFromQuote(quote: {
  regularMarketVolume?: number | null;
  averageDailyVolume10Day?: number | null;
  averageDailyVolume3Month?: number | null;
}): number | null {
  const volume = Number(quote.regularMarketVolume ?? 0);
  const average10d = Number(quote.averageDailyVolume10Day ?? 0);
  const average3m = Number(quote.averageDailyVolume3Month ?? 0);

  if (average10d > 0 && volume / average10d >= 0.2) {
    return Math.round((volume / average10d) * 10) / 10;
  }
  if (average10d > 0 && average3m > 0) {
    return Math.round((average10d / average3m) * 10) / 10;
  }
  return null;
}
```

---

## Fil: artifacts/api-server/src/lib/edgeAiSource.ts

```typescript
const EDGEAI_CONTENTS_API_URL =
  "https://api.github.com/repos/alexgianni777-tech/edgeai/contents/public/data.json?ref=main";
const EDGEAI_RAW_URL =
  "https://raw.githubusercontent.com/alexgianni777-tech/edgeai/main/public/data.json";

const WARN_EDGEAI_DATA_AGE_MS = 30 * 60 * 60 * 1_000;
const MAX_EDGEAI_IMPORT_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export class EdgeAiDataFreshnessError extends Error {
  constructor(
    message: string,
    public readonly generatedAt: string | null,
  ) {
    super(message);
    this.name = "EdgeAiDataFreshnessError";
  }
}

/**
 * raw.githubusercontent.com can keep serving yesterday's file after EdgeAI has
 * committed fresh data. Fetch the canonical repository content through GitHub's
 * API instead. The manual button may import the latest valid signal file when
 * it is older than today (for example after a weekend), while the scheduler
 * keeps the strict default and waits for today's file.
 */
export async function fetchFreshEdgeAiData(
  timeoutMs: number,
  options: { allowStale?: boolean } = {},
): Promise<any> {
  let response = await fetch(EDGEAI_CONTENTS_API_URL, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      "Cache-Control": "no-cache",
      "User-Agent": "omxs30-screener",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const contentsStatus = response.status;
    response = await fetch(`${EDGEAI_RAW_URL}?fallback=${Date.now()}`, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "omxs30-screener",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `EdgeAI fetch failed (GitHub API HTTP ${contentsStatus}, raw fallback HTTP ${response.status})`,
      );
    }
  }

  const data: any = await response.json();
  const generatedAt = typeof data?.generatedAt === "string" ? data.generatedAt : null;
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;

  if (!Number.isFinite(generatedAtMs)) {
    throw new EdgeAiDataFreshnessError(
      "EdgeAI response has no valid generatedAt timestamp",
      generatedAt,
    );
  }

  const freshness = edgeAiDataFreshness(data);
  const tooFarInFuture = freshness.ageMs < -5 * 60 * 1_000;
  const tooOld = freshness.ageMs > MAX_EDGEAI_IMPORT_AGE_MS;
  const staleForStrictImport = freshness.ageMs > WARN_EDGEAI_DATA_AGE_MS || freshness.isDifferentUtcDate;
  if (tooFarInFuture || tooOld || (staleForStrictImport && !options.allowStale)) {
    const ageDescription = freshness.ageDescription;
    throw new EdgeAiDataFreshnessError(
      tooFarInFuture
        ? `EdgeAI-data har en framtida tidsstämpel (${generatedDateLabel(generatedAtMs)})`
        : tooOld
          ? `EdgeAI-data är ${ageDescription} (${generatedDateLabel(generatedAtMs)}) och för gammal för import`
          : `EdgeAI-data är ${ageDescription} (${generatedDateLabel(generatedAtMs)}) och importeras inte som dagens session`,
      generatedAt,
    );
  }

  return data;
}

function generatedDateLabel(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function edgeAiDataFreshness(data: { generatedAt?: unknown }): {
  ageMs: number;
  isDifferentUtcDate: boolean;
  calendarDaysOld: number;
  ageDescription: string;
} {
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : "";
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    throw new EdgeAiDataFreshnessError(
      "EdgeAI response has no valid generatedAt timestamp",
      generatedAt || null,
    );
  }

  const ageMs = Date.now() - generatedAtMs;
  const generatedDate = generatedDateLabel(generatedAtMs);
  const currentDate = new Date().toISOString().slice(0, 10);
  const generatedDayMs = Date.parse(`${generatedDate}T00:00:00.000Z`);
  const currentDayMs = Date.parse(`${currentDate}T00:00:00.000Z`);
  const calendarDaysOld = Math.round((currentDayMs - generatedDayMs) / 86_400_000);
  const ageDescription =
    calendarDaysOld === 0
      ? "från i dag"
      : calendarDaysOld === 1
        ? "från igår"
        : calendarDaysOld > 1
          ? `${calendarDaysOld} kalenderdagar gammal`
          : `från ${generatedDate}`;

  return {
    ageMs,
    isDifferentUtcDate: generatedDate !== currentDate,
    calendarDaysOld,
    ageDescription,
  };
}

export function edgeAiSessionDate(data: { generatedAt?: unknown }): string {
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : "";
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) {
    throw new EdgeAiDataFreshnessError("EdgeAI response has no valid generatedAt timestamp", generatedAt || null);
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function edgeAiDirection(value: unknown): "LONG" | "SHORT" {
  return String(value ?? "").trim().toLowerCase() === "short" ? "SHORT" : "LONG";
}
```

---

## Fil: artifacts/api-server/src/routes/analytics.ts

```typescript
/**
 * GET /api/screener/analytics/top3
 *
 * Hypothetical "top 3 per session" strategy performance.
 * For every session, picks the 3 candidates with the highest edge score
 * (winRate × expectancyR), then tracks their logged outcomes as R-multiples.
 * PENDING outcomes are excluded from running totals.
 *
 * Manual top-3 overrides (isTop3Pick === true) take precedence over auto-rank.
 * Each pick includes `earningsWarning: true` when the stock had an earnings
 * report within 0–5 calendar days of the session date (Rule 7 exclusion zone).
 * It is flagged only for a verified SIGNAL_TIME observation; legacy values
 * have unknown provenance and must not be treated as Rule 7 evidence.
 */
import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, screenerSessionsTable, candidatesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/screener/analytics/top3", async (_req, res): Promise<void> => {
  const sessions = await db
    .select({ id: screenerSessionsTable.id, date: screenerSessionsTable.date, source: screenerSessionsTable.source, edgeWinRate: screenerSessionsTable.edgeWinRate })
    .from(screenerSessionsTable)
    .orderBy(asc(screenerSessionsTable.date));

  if (sessions.length === 0) {
    res.json({ sessions: [], stats: emptyStats() });
    return;
  }

  const allCandidates = await db.select().from(candidatesTable);

  // Group by session
  const bySession = new Map<number, typeof allCandidates>();
  for (const c of allCandidates) {
    if (!bySession.has(c.sessionId)) bySession.set(c.sessionId, []);
    bySession.get(c.sessionId)!.push(c);
  }

  let cumulativeR = 0;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;

  // Per-direction (buy vs. sell picks) breakdown — same accounting as the
  // aggregate totals above, split by whether the pick was a LONG or SHORT.
  const byDirection = {
    LONG: { totalTrades: 0, wins: 0, losses: 0, totalR: 0 },
    SHORT: { totalTrades: 0, wins: 0, losses: 0, totalR: 0 },
  };

  const sessionResults = sessions.map((session) => {
    const candidates = bySession.get(session.id) ?? [];

    // Sort by edge score descending: (winRate/100) × (expectancyR×100/100)
    // = perf1m × rsi — monotone so no need to divide
    const sorted = [...candidates].sort(
      (a, b) => (b.perf1m ?? 0) * (b.rsi ?? 0) - (a.perf1m ?? 0) * (a.rsi ?? 0),
    );

    // Top 3 is deliberately per direction: up to three LONG and three SHORT
    // candidates. Manual choices override auto-rank within their own direction.
    const deterministicSort = (items: typeof candidates) =>
      [...items].sort(
        (a, b) =>
          (b.perf1m ?? 0) * (b.rsi ?? 0) - (a.perf1m ?? 0) * (a.rsi ?? 0) ||
          a.rank - b.rank ||
          a.ticker.localeCompare(b.ticker),
      );
    const manualPicks = candidates.filter((c) => c.isTop3Pick === true);
    const selectDirection = (direction: "LONG" | "SHORT") => {
      const pool = candidates.filter((candidate) =>
        direction === "SHORT"
          ? candidate.direction === "SHORT"
          : candidate.direction !== "SHORT",
      );
      const manual = manualPicks.filter((candidate) =>
        direction === "SHORT"
          ? candidate.direction === "SHORT"
          : candidate.direction !== "SHORT",
      );
      return deterministicSort(manual.length > 0 ? manual : pool).slice(0, 3);
    };
    const topLong = selectDirection("LONG");
    const topShort = selectDirection("SHORT");
    const top3 = [...topLong, ...topShort];

    let sessionR = 0;
    let sessionHasResolved = false;

    const picks = top3.map((c) => {
      const dirBucket = c.direction === "SHORT" ? byDirection.SHORT : byDirection.LONG;

      let r: number | null = null;
      // Resolutions written after realized-R support persist the authoritative
      // value. For old rows, only use a conservatively reconstructable exit;
      // never turn a planned R:R or a bare WIN/LOSS label into a performance
      // number.
      const legacyR = c.exitPrice != null
        ? (() => {
            const entry = c.resolutionEntryPrice ?? c.entryPrice;
            const stop = c.resolutionStopPrice ?? c.stopPrice;
            const direction = c.resolutionDirection ?? c.direction;
            const oneR = Math.abs(entry - stop);
            return oneR > 0
              ? (direction === "LONG" ? (c.exitPrice! - entry) / oneR : (entry - c.exitPrice!) / oneR)
              : null;
          })()
        : null;
      const persistedR = c.realizedR ?? legacyR;
      if (c.outcome === "WIN" && persistedR != null && persistedR > 0) {
        r = persistedR;
        wins++;
        totalTrades++;
        sessionHasResolved = true;
        sessionR += r;
        cumulativeR += r;
        dirBucket.wins++;
        dirBucket.totalTrades++;
        dirBucket.totalR += r;
      } else if (c.outcome === "LOSS" && persistedR != null && persistedR < 0) {
        r = persistedR;
        losses++;
        totalTrades++;
        sessionHasResolved = true;
        sessionR += r;
        cumulativeR += r;
        dirBucket.losses++;
        dirBucket.totalTrades++;
        dirBucket.totalR += r;
      }

      const eid = c.earningsInDays;
      const earningsWarning = c.earningsKnowledge === "SIGNAL_TIME" && eid != null && eid >= 0 && eid <= 5;

      return {
        ticker: c.ticker,
        direction: c.direction,
        edgeScore: Number(
          (((c.perf1m ?? 0) / 100) * ((c.rsi ?? 0) / 100)).toFixed(4),
        ),
        outcome: c.outcome,
        r,
        earningsWarning,
      };
    });

    // Direction split — informational picks per direction, not counted in cumulative R
    const mapInfoPick = (c: (typeof allCandidates)[0]) => {
      const eid = c.earningsInDays;
      const entry = c.resolutionEntryPrice ?? c.entryPrice;
      const stop = c.resolutionStopPrice ?? c.stopPrice;
      const direction = c.resolutionDirection ?? c.direction;
      const oneR = Math.abs(entry - stop);
      const legacyR = c.exitPrice != null && oneR > 0
        ? (direction === "LONG" ? (c.exitPrice - entry) / oneR : (entry - c.exitPrice) / oneR)
        : null;
      const persistedR = c.realizedR ?? legacyR;
      return {
        ticker: c.ticker,
        direction: c.direction,
        edgeScore: Number((((c.perf1m ?? 0) / 100) * ((c.rsi ?? 0) / 100)).toFixed(4)),
        outcome: c.outcome,
        r: (c.outcome === "WIN" && persistedR != null && persistedR > 0) ||
          (c.outcome === "LOSS" && persistedR != null && persistedR < 0)
          ? persistedR
          : null,
        earningsWarning: c.earningsKnowledge === "SIGNAL_TIME" && eid != null && eid >= 0 && eid <= 5,
      };
    };

    return {
      date: session.date,
      sessionId: session.id,
      source: session.source ?? null,
      picks,
      longPicks: topLong.map(mapInfoPick),
      shortPicks: topShort.map(mapInfoPick),
      edgeWinRate: session.edgeWinRate ?? null,
      sessionR: sessionHasResolved ? sessionR : null,
      cumulativeR,
    };
  });

  const winRate = totalTrades > 0 ? wins / totalTrades : null;
  const avgRPerTrade = totalTrades > 0 ? cumulativeR / totalTrades : null;

  const summarizeDirection = (b: { totalTrades: number; wins: number; losses: number; totalR: number }) => ({
    totalTrades: b.totalTrades,
    wins: b.wins,
    losses: b.losses,
    winRate: b.totalTrades > 0 ? b.wins / b.totalTrades : null,
    totalR: b.totalR,
    avgRPerTrade: b.totalTrades > 0 ? b.totalR / b.totalTrades : null,
  });

  res.json({
    sessions: sessionResults,
    stats: {
      totalSessions: sessions.length,
      completedSessions: sessionResults.filter((s) => s.sessionR !== null).length,
      totalTrades,
      wins,
      losses,
      winRate,
      totalR: cumulativeR,
      avgRPerTrade,
      byDirection: {
        LONG: summarizeDirection(byDirection.LONG),
        SHORT: summarizeDirection(byDirection.SHORT),
      },
    },
  });
});

function emptyStats() {
  return {
    totalSessions: 0,
    completedSessions: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    totalR: 0,
    avgRPerTrade: null,
    byDirection: {
      LONG: { totalTrades: 0, wins: 0, losses: 0, winRate: null, totalR: 0, avgRPerTrade: null },
      SHORT: { totalTrades: 0, wins: 0, losses: 0, winRate: null, totalR: 0, avgRPerTrade: null },
    },
  };
}

export default router;

```

---

## Fil: artifacts/api-server/src/routes/dashboard.ts

```typescript
import { Router, type IRouter } from "express";
import { sql, eq, and, ne, inArray } from "drizzle-orm";
import { db, candidatesTable, screenerSessionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /dashboard/summary
router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  // Total sessions
  const [sessionCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(screenerSessionsTable);
  const totalSessions = Number(sessionCountRow?.count ?? 0);

  // Total candidates and outcome breakdown
  const outcomeRows = await db
    .select({
      outcome: candidatesTable.outcome,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(candidatesTable)
    .groupBy(candidatesTable.outcome);

  let wins = 0;
  let losses = 0;
  let totalCandidates = 0;

  for (const row of outcomeRows) {
    const count = Number(row.count);
    totalCandidates += count;
    if (row.outcome === "WIN") wins = count;
    if (row.outcome === "LOSS") losses = count;
  }

  const resolvedTrades = wins + losses;
  const overallWinRate = resolvedTrades > 0 ? wins / resolvedTrades : null;

  // Per-category stats
  const categoryRows = await db
    .select({
      category: candidatesTable.category,
      outcome: candidatesTable.outcome,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(candidatesTable)
    .groupBy(candidatesTable.category, candidatesTable.outcome);

  const categoryMap: Record<
    string,
    { total: number; wins: number; losses: number; skips: number; pending: number }
  > = {};

  for (const row of categoryRows) {
    const count = Number(row.count);
    if (!categoryMap[row.category]) {
      categoryMap[row.category] = { total: 0, wins: 0, losses: 0, skips: 0, pending: 0 };
    }
    categoryMap[row.category].total += count;
    if (row.outcome === "WIN") categoryMap[row.category].wins += count;
    if (row.outcome === "LOSS") categoryMap[row.category].losses += count;
    if (row.outcome === "SKIP") categoryMap[row.category].skips += count;
    if (row.outcome === "PENDING") categoryMap[row.category].pending += count;
  }

  const allCategories = ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] as const;
  const byCategory = allCategories.map((cat) => {
    const stats = categoryMap[cat] ?? { total: 0, wins: 0, losses: 0, skips: 0, pending: 0 };
    const resolved = stats.wins + stats.losses;
    return {
      category: cat,
      total: stats.total,
      wins: stats.wins,
      losses: stats.losses,
      skips: stats.skips,
      pending: stats.pending,
      winRate: resolved > 0 ? stats.wins / resolved : null,
    };
  });

  // P&L / R-multiple stats — fetch resolved trades with prices, ordered by session date
  const resolvedRows = await db
    .select({
      ticker: candidatesTable.ticker,
      outcome: candidatesTable.outcome,
      direction: candidatesTable.direction,
      entryPrice: candidatesTable.entryPrice,
      stopPrice: candidatesTable.stopPrice,
      exitPrice: candidatesTable.exitPrice,
      realizedR: candidatesTable.realizedR,
      resolutionEntryPrice: candidatesTable.resolutionEntryPrice,
      resolutionStopPrice: candidatesTable.resolutionStopPrice,
      resolutionDirection: candidatesTable.resolutionDirection,
      sessionDate: screenerSessionsTable.date,
    })
    .from(candidatesTable)
    .innerJoin(screenerSessionsTable, eq(candidatesTable.sessionId, screenerSessionsTable.id))
    .where(inArray(candidatesTable.outcome, ["WIN", "LOSS"]))
    .orderBy(screenerSessionsTable.date, candidatesTable.id);

  // Calculate R for each trade: R = signed gain / |entry - stop|
  interface TradeR {
    r: number;
    date: string;
    ticker: string;
    outcome: "WIN" | "LOSS";
  }
  const tradeRs: TradeR[] = [];

  for (const row of resolvedRows) {
    if (
      row.exitPrice == null ||
      row.entryPrice == null ||
      row.stopPrice == null
    ) {
      continue;
    }
    // New resolutions persist R at the time they are recorded, so later
    // signal re-imports cannot rewrite their realized performance. Keep the
    // calculation as a fallback for all legacy outcome rows.
    const entryPrice = row.resolutionEntryPrice ?? row.entryPrice;
    const stopPrice = row.resolutionStopPrice ?? row.stopPrice;
    const direction = row.resolutionDirection ?? row.direction;
    const oneRUnit = Math.abs(entryPrice - stopPrice);
    if (oneRUnit === 0) continue;
    const r = row.realizedR ?? (direction === "LONG"
      ? (row.exitPrice - entryPrice) / oneRUnit
      : (entryPrice - row.exitPrice) / oneRUnit);

    tradeRs.push({
      r,
      date: row.sessionDate,
      ticker: row.ticker,
      outcome: row.outcome as "WIN" | "LOSS",
    });
  }

  // Equity curve
  let cumulative = 0;
  const equityCurve = tradeRs.map((t, i) => {
    cumulative += t.r;
    return {
      tradeIndex: i + 1,
      cumulativeR: Math.round(cumulative * 1000) / 1000,
      r: Math.round(t.r * 1000) / 1000,
      date: t.date,
      ticker: t.ticker,
      outcome: t.outcome,
    };
  });

  // Aggregate stats
  const winRs = tradeRs.filter((t) => t.outcome === "WIN").map((t) => t.r);
  const lossRs = tradeRs.filter((t) => t.outcome === "LOSS").map((t) => t.r);

  const avgRWin =
    winRs.length > 0 ? winRs.reduce((a, b) => a + b, 0) / winRs.length : null;
  const avgRLoss =
    lossRs.length > 0 ? lossRs.reduce((a, b) => a + b, 0) / lossRs.length : null;

  const payoffRatio =
    avgRWin != null && avgRLoss != null && avgRLoss !== 0
      ? avgRWin / Math.abs(avgRLoss)
      : null;

  // EV is computed from the same exit-priced population as the R stats
  const pricedWins = winRs.length;
  const pricedLosses = lossRs.length;
  const pricedResolved = pricedWins + pricedLosses;
  const pricedWinRate = pricedResolved > 0 ? pricedWins / pricedResolved : null;

  const expectedValue =
    pricedWinRate != null && avgRWin != null && avgRLoss != null
      ? pricedWinRate * avgRWin + (1 - pricedWinRate) * avgRLoss
      : null;

  res.json(
    GetDashboardSummaryResponse.parse({
      totalSessions,
      totalCandidates,
      resolvedTrades,
      wins,
      losses,
      overallWinRate,
      byCategory,
      avgRWin,
      avgRLoss,
      payoffRatio,
      expectedValue,
      equityCurve,
    })
  );
});

export default router;

```

---

## Fil: artifacts/api-server/src/routes/candidates.ts

```typescript
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

```

---

## Fil: artifacts/api-server/src/routes/portfolio.ts

```typescript
/**
 * GET /api/portfolio
 *
 * Returns all open positions enriched with live Yahoo Finance quotes.
 * Each position is extended with:
 *   - livePrice, changePct
 *   - unrealised P&L in SEK and as a percentage
 *   - current R multiple (how many R the trade is currently up/down)
 *   - distance to stop (%) and distance to target (%)
 */
import { Router, type IRouter } from "express";
import { db, openPositionsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";
import { resolveYahooTicker } from "../lib/omxs30TickerMap";

const router: IRouter = Router();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

type QuoteInfo = { livePrice: number | null; changePct: number | null; asOf: string | null };

async function fetchQuotes(tickers: string[]): Promise<Map<string, QuoteInfo>> {
  const map = new Map<string, QuoteInfo>();
  await Promise.allSettled(
    [...new Set(tickers)].map(async (ticker) => {
      try {
        const q = await yf.quote(resolveYahooTicker(ticker), {}, { validateResult: false }) as any;
        const marketTime: Date | null = q.regularMarketTime ?? null;
        map.set(ticker, {
          livePrice: q.regularMarketPrice ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          asOf: marketTime instanceof Date ? marketTime.toISOString() : null,
        });
      } catch {
        map.set(ticker, { livePrice: null, changePct: null, asOf: null });
      }
    }),
  );
  return map;
}

router.get("/portfolio", async (_req, res): Promise<void> => {
  const positions = await db
    .select()
    .from(openPositionsTable)
    .orderBy(asc(openPositionsTable.createdAt));

  const fetchedAt = new Date().toISOString();

  if (positions.length === 0) {
    res.json({
      positions: [],
      summary: {
        count: 0,
        totalInvestedKr: 0,
        totalMarketValueKr: 0,
        totalUnrealisedKr: 0,
        totalUnrealisedPct: 0,
        maxStopLossKr: 0,
        longExposureKr: 0,
        shortExposureKr: 0,
        grossExposureKr: 0,
        netExposureKr: 0,
      },
      fetchedAt,
    });
    return;
  }

  const quoteMap = await fetchQuotes(positions.filter((p) => !p.instrument).map((p) => p.ticker));

  const enriched = positions.map((p) => {
    const q = quoteMap.get(p.ticker) ?? { livePrice: null, changePct: null, asOf: null };
    const live = p.instrument ? (p.lastPrice ?? null) : q.livePrice;
    const changePct = p.instrument ? null : q.changePct;
    // Instruments (leveraged products) are priced from the broker's last pasted
    // export, not a live feed — there is no market timestamp for those.
    const quoteAsOf = p.instrument ? null : q.asOf;

    const isShort = p.direction === "SHORT";
    const risk1R = p.stopPrice != null ? Math.abs(p.entryPrice - p.stopPrice) : null;
    // Stop P&L is signed and applies to every valid stop, including
    // break-even, profit-locking, and trailing stops.
    const stopPnlKr = p.stopPrice != null
      ? (isShort ? p.entryPrice - p.stopPrice : p.stopPrice - p.entryPrice) * p.shares
      : null;
    const stopPnlPct = p.stopPrice != null
      ? (isShort ? p.entryPrice - p.stopPrice : p.stopPrice - p.entryPrice) / p.entryPrice * 100
      : null;
    // Only a stop on the loss side is a protective stop. Do not present a
    // profit-locking or incorrectly placed stop as a maximum potential loss.
    const hasProtectiveStop = stopPnlKr != null && stopPnlKr < 0;
    const riskToStopKr = hasProtectiveStop ? Math.abs(p.entryPrice - p.stopPrice!) * p.shares : null;
    const riskToStopPct = hasProtectiveStop
      ? (Math.abs(p.entryPrice - p.stopPrice!) / p.entryPrice) * 100
      : null;

    // Unrealised P&L
    let unrealisedPct: number | null = null;
    let unrealisedKr: number | null = null;
    let currentR: number | null = null;
    let distToStop: number | null = null;
    let distToTarget: number | null = null;

    if (live != null) {
      const priceDelta = isShort ? p.entryPrice - live : live - p.entryPrice;
      unrealisedPct = (priceDelta / p.entryPrice) * 100;
      unrealisedKr = priceDelta * p.shares;
      if (risk1R != null && risk1R > 0) currentR = priceDelta / risk1R;

      if (p.stopPrice != null) {
        distToStop = isShort
          ? ((p.stopPrice - live) / live) * 100   // how far above live price stop is
          : ((live - p.stopPrice) / live) * 100;  // how far below live price stop is
      }
      if (p.targetPrice != null) {
        distToTarget = isShort
          ? ((live - p.targetPrice) / live) * 100  // how far to fall to target
          : ((p.targetPrice - live) / live) * 100; // how far to rise to target
      }
    }

    const positionSizeKr = p.entryPrice * p.shares;
    const marketValueKr = live != null ? live * p.shares : null;

    return {
      id: p.id,
      ticker: p.ticker,
      instrument: p.instrument ?? null,
      direction: p.direction,
      market: p.market ?? null,
      notes: p.notes ?? null,
      entryPrice: p.entryPrice,
      lastPrice: p.lastPrice ?? null,
      stopPrice: p.stopPrice ?? null,
      targetPrice: p.targetPrice ?? null,
      shares: p.shares,
      positionSizeKr,
      risk1R: risk1R != null ? risk1R * p.shares : null,
      riskToStopKr: riskToStopKr != null ? +riskToStopKr.toFixed(0) : null,
      riskToStopPct: riskToStopPct != null ? +riskToStopPct.toFixed(2) : null,
      stopPnlKr: stopPnlKr != null ? +stopPnlKr.toFixed(0) : null,
      stopPnlPct: stopPnlPct != null ? +stopPnlPct.toFixed(2) : null,
      createdAt: p.createdAt,
      livePrice: live,
      changePct,
      quoteAsOf,
      unrealisedPct: unrealisedPct != null ? +unrealisedPct.toFixed(2) : null,
      unrealisedKr: unrealisedKr != null ? +unrealisedKr.toFixed(0) : null,
      currentR: currentR != null ? +currentR.toFixed(2) : null,
      marketValueKr,
      distToStop: distToStop != null ? +distToStop.toFixed(2) : null,
      distToTarget: distToTarget != null ? +distToTarget.toFixed(2) : null,
    };
  });

  const totalUnrealisedKr = enriched.reduce((s, p) => s + (p.unrealisedKr ?? 0), 0);
  const totalMarketValueKr = enriched.reduce((s, p) => s + (p.marketValueKr ?? p.positionSizeKr), 0);
  const totalInvestedKr = enriched.reduce((s, p) => s + p.positionSizeKr, 0);
  const maxStopLossKr = enriched.reduce(
    (sum, position) => sum + Math.max(0, -(position.stopPnlKr ?? 0)),
    0,
  );
  const longExposureKr = enriched
    .filter((p) => p.direction === "LONG")
    .reduce((s, p) => s + (p.marketValueKr ?? p.positionSizeKr), 0);
  const shortExposureKr = enriched
    .filter((p) => p.direction === "SHORT")
    .reduce((s, p) => s + (p.marketValueKr ?? p.positionSizeKr), 0);

  res.json({
    positions: enriched,
    summary: {
      count: enriched.length,
      totalInvestedKr: +totalInvestedKr.toFixed(0),
      totalMarketValueKr: +totalMarketValueKr.toFixed(0),
      totalUnrealisedKr: +totalUnrealisedKr.toFixed(0),
      totalUnrealisedPct: totalInvestedKr > 0 ? +((totalUnrealisedKr / totalInvestedKr) * 100).toFixed(2) : 0,
      maxStopLossKr: +maxStopLossKr.toFixed(0),
      longExposureKr: +longExposureKr.toFixed(0),
      shortExposureKr: +shortExposureKr.toFixed(0),
      grossExposureKr: +(longExposureKr + shortExposureKr).toFixed(0),
      netExposureKr: +(longExposureKr - shortExposureKr).toFixed(0),
    },
    fetchedAt,
  });
});

// POST /portfolio  — add position
router.post("/portfolio", async (req, res): Promise<void> => {
  const { ticker, instrument, direction, entryPrice, shares, stopPrice, targetPrice, market, notes } = req.body ?? {};
  if (
    typeof ticker !== "string" || !ticker.trim() ||
    !["LONG", "SHORT"].includes(direction) ||
    typeof entryPrice !== "number" || !isFinite(entryPrice) || entryPrice <= 0 ||
    typeof shares !== "number" || !isFinite(shares) || shares <= 0
  ) {
    res.status(400).json({ error: "Ogiltiga fält: ticker, direction, entryPrice och shares krävs." });
    return;
  }
  const [pos] = await db
    .insert(openPositionsTable)
    .values({
      ticker: ticker.trim().toUpperCase(),
      instrument: typeof instrument === "string" && instrument.trim() ? instrument.trim() : null,
      direction,
      entryPrice,
      lastPrice: null,
      shares,
      stopPrice: typeof stopPrice === "number" && isFinite(stopPrice) && stopPrice > 0 ? stopPrice : null,
      targetPrice: typeof targetPrice === "number" && isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null,
      market: typeof market === "string" && market ? market.toUpperCase() : null,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    })
    .returning();
  res.status(201).json(pos);
});

// PATCH /portfolio/:id — edit an existing open position in place (no delete + re-add).
router.patch("/portfolio/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Ogiltigt id" }); return; }

  const [existing] = await db.select().from(openPositionsTable).where(eq(openPositionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Position hittades inte" }); return; }

  const { ticker, instrument, direction, entryPrice, shares, stopPrice, targetPrice, market, notes } = req.body ?? {};
  const updates: Partial<typeof openPositionsTable.$inferInsert> = {};

  if (ticker !== undefined) {
    if (typeof ticker !== "string" || !ticker.trim()) { res.status(400).json({ error: "Ogiltig ticker." }); return; }
    updates.ticker = ticker.trim().toUpperCase();
  }
  if (instrument !== undefined) {
    updates.instrument = typeof instrument === "string" && instrument.trim() ? instrument.trim() : null;
  }
  if (direction !== undefined) {
    if (!["LONG", "SHORT"].includes(direction)) { res.status(400).json({ error: "Ogiltig riktning." }); return; }
    updates.direction = direction;
  }
  if (entryPrice !== undefined) {
    if (typeof entryPrice !== "number" || !isFinite(entryPrice) || entryPrice <= 0) { res.status(400).json({ error: "Ogiltigt entry-pris." }); return; }
    updates.entryPrice = entryPrice;
  }
  if (shares !== undefined) {
    if (typeof shares !== "number" || !isFinite(shares) || shares <= 0) { res.status(400).json({ error: "Ogiltigt antal aktier." }); return; }
    updates.shares = shares;
  }
  if (stopPrice !== undefined) {
    updates.stopPrice = typeof stopPrice === "number" && isFinite(stopPrice) && stopPrice > 0 ? stopPrice : null;
  }
  if (targetPrice !== undefined) {
    updates.targetPrice = typeof targetPrice === "number" && isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null;
  }
  if (market !== undefined) {
    updates.market = typeof market === "string" && market ? market.toUpperCase() : null;
  }
  if (notes !== undefined) {
    updates.notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Inga fält att uppdatera." });
    return;
  }

  const [updated] = await db
    .update(openPositionsTable)
    .set(updates)
    .where(eq(openPositionsTable.id, id))
    .returning();
  res.json(updated);
});

// POST /portfolio/import — update positions from a pasted broker export.
// Existing positions are matched by underlying ticker + instrument, so repeating
// an import refreshes the position instead of creating another row.
router.post("/portfolio/import", async (req, res): Promise<void> => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) {
    res.status(400).json({ error: "Minst en och högst 100 positioner krävs." });
    return;
  }

  const validEntries: Array<{
    ticker: string;
    instrument: string;
    direction: "LONG" | "SHORT";
    entryPrice: number;
    lastPrice: number;
    shares: number;
    market: string | null;
  }> = [];

  for (const entry of entries) {
    if (
      typeof entry?.ticker !== "string" || !entry.ticker.trim() ||
      typeof entry?.instrument !== "string" || !entry.instrument.trim() ||
      !["LONG", "SHORT"].includes(entry.direction) ||
      typeof entry?.entryPrice !== "number" || !isFinite(entry.entryPrice) || entry.entryPrice <= 0 ||
      typeof entry?.lastPrice !== "number" || !isFinite(entry.lastPrice) || entry.lastPrice <= 0 ||
      typeof entry?.shares !== "number" || !isFinite(entry.shares) || entry.shares <= 0
    ) {
      res.status(400).json({ error: "Varje importposition måste ha ticker, instrument, riktning, antal, inköpskurs och aktuell kurs." });
      return;
    }
    validEntries.push({
      ticker: entry.ticker.trim().toUpperCase(),
      instrument: entry.instrument.trim(),
      direction: entry.direction,
      entryPrice: entry.entryPrice,
      lastPrice: entry.lastPrice,
      shares: entry.shares,
      market: typeof entry.market === "string" && entry.market.trim() ? entry.market.trim().toUpperCase() : null,
    });
  }

  const existing = await db.select().from(openPositionsTable);
  let created = 0;
  let updated = 0;

  for (const entry of validEntries) {
    const match = existing.find((position) =>
      position.ticker.toUpperCase() === entry.ticker &&
      (position.instrument ?? "").trim().toLowerCase() === entry.instrument.toLowerCase(),
    );

    if (match) {
      await db
        .update(openPositionsTable)
        .set({
          direction: entry.direction,
          entryPrice: entry.entryPrice,
          lastPrice: entry.lastPrice,
          shares: entry.shares,
          market: entry.market ?? match.market,
        })
        .where(eq(openPositionsTable.id, match.id));
      updated++;
    } else {
      const [createdPosition] = await db
        .insert(openPositionsTable)
        .values({
          ticker: entry.ticker,
          instrument: entry.instrument,
          direction: entry.direction,
          entryPrice: entry.entryPrice,
          lastPrice: entry.lastPrice,
          shares: entry.shares,
          market: entry.market,
          stopPrice: null,
          targetPrice: null,
          notes: null,
        })
        .returning();
      existing.push(createdPosition);
      created++;
    }
  }

  res.status(200).json({ created, updated, total: validEntries.length });
});

// DELETE /portfolio/:id
router.delete("/portfolio/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Ogiltigt id" }); return; }
  const [deleted] = await db
    .delete(openPositionsTable)
    .where(eq(openPositionsTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Position hittades inte" }); return; }
  res.sendStatus(204);
});

export default router;

```

---

## Fil: lib/db/src/schema/candidates.ts

```typescript
import { pgTable, serial, integer, text, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { screenerSessionsTable } from "./screenerSessions";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => screenerSessionsTable.id, { onDelete: "cascade" }),
  category: text("category", { enum: ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] }).notNull(),
  rank: integer("rank").notNull(),
  ticker: text("ticker").notNull(),
  price: real("price").notNull(),
  rs3m: real("rs3m").notNull(),
  perf1m: real("perf_1m").notNull(),
  rsi: integer("rsi").notNull(),
  pctB: real("pct_b").notNull(),
  atr: real("atr").notNull(),
  volMultiplier: real("vol_multiplier").notNull(),
  // Separate signal inputs from legacy display fields: EdgeAI uses `rsi` for E[R].
  signalRsi: real("signal_rsi"),
  signalGapPct: real("signal_gap_pct"),
  distFrom20dH: real("dist_from_20d_h").notNull(),
  gapWarning: real("gap_warning"),
  // Rule 7 is a point-in-time signal attribute. A value is usable only when
  // Yahoo was observed on the signal day; legacy/null provenance is UNKNOWN.
  earningsInDays: integer("earnings_in_days"),
  earningsKnowledge: text("earnings_knowledge", {
    enum: ["SIGNAL_TIME", "UNKNOWN"],
  }),
  earningsObservedAt: timestamp("earnings_observed_at", { withTimezone: true }),
  // Nullable: legacy rows imported before market tagging existed can still be NULL
  // in production (this screener's history predates EdgeAI's US support, so any
  // untagged legacy row is Swedish by construction, but we can't force-backfill
  // production data from here). API responses coalesce null -> "SE" at the
  // mapCandidate boundary instead of enforcing NOT NULL at the DB level — see
  // lib/db/SCHEMA-SAFETY.md history and #52.
  market: text("market", { enum: ["SE", "US"] }).default("SE"),
  signalSource: text("signal_source", { enum: ["edgeai", "telegram", "manual", "screener"] }),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryPrice: real("entry_price").notNull(),
  stopPrice: real("stop_price").notNull(),
  targetPrice: real("target_price").notNull(),
  rr: real("rr").notNull(),
  oneR: real("one_r").notNull(),
  outcome: text("outcome", { enum: ["WIN", "LOSS", "SKIP", "PENDING"] }).notNull().default("PENDING"),
  exitPrice: real("exit_price"),
  outcomeNotes: text("outcome_notes"),
  // A resolved trade must say whether its price was recorded from an actual
  // exit or is an explicitly-labelled planned-level assumption. Null preserves
  // pre-existing outcome history whose resolution provenance was not captured.
  resolutionMethod: text("resolution_method", {
    enum: ["MANUAL_EXIT", "TARGET_HIT", "STOP_HIT"],
  }),
  resolutionQuality: text("resolution_quality", {
    enum: ["RECORDED_EXIT", "ASSUMED_LEVEL", "LEGACY_UNKNOWN"],
  }),
  realizedR: real("realized_r"),
  // Written once when an outcome is resolved. Later signal re-imports may
  // update the live plan, but must never change the denominator of a logged R.
  resolutionEntryPrice: real("resolution_entry_price"),
  resolutionStopPrice: real("resolution_stop_price"),
  resolutionDirection: text("resolution_direction", { enum: ["LONG", "SHORT"] }),
  isTop3Pick: boolean("is_top3_pick").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;

```

---

## Fil: lib/db/src/schema/screenerSessions.ts

```typescript
import { pgTable, serial, text, real, integer, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const screenerSessionsTable = pgTable("screener_sessions", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull().unique(),
  omxsValue: real("omxs_value").notNull(),
  perf5d: real("perf_5d").notNull(),
  perf1m: real("perf_1m").notNull(),
  perf3m: real("perf_3m").notNull(),
  marketRsi: real("market_rsi").notNull(),
  trendLabel: text("trend_label").notNull(),
  rawText: text("raw_text").notNull(),
  // EdgeAI metadata — populated when source is "edgeai"
  source: text("source"),          // "edgeai" | null (manual)
  edgeRegime: text("edge_regime"), // JSON string
  edgeExpectancy: real("edge_expectancy"),
  edgeWinRate: real("edge_win_rate"),
  edgePF: real("edge_pf"),
  edgeN: integer("edge_n"),
  // Snapshot of what the most recent import changed (added/updated/removed
  // candidates), so traders can see exactly what a re-import touched without
  // diffing session history manually. Null until the first re-import happens.
  lastImportDiff: jsonb("last_import_diff"),
  lastImportAt: timestamp("last_import_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScreenerSessionSchema = createInsertSchema(screenerSessionsTable).omit({
  id: true,
  createdAt: true,
  lastImportDiff: true,
  lastImportAt: true,
});
export type InsertScreenerSession = z.infer<typeof insertScreenerSessionSchema>;
export type ScreenerSession = typeof screenerSessionsTable.$inferSelect;

```
