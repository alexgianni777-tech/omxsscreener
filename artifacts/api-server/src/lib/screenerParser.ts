import { textReportQuality } from "./candidateDataQuality";
import type { CandidateDataQuality } from "@workspace/db";
/**
 * Parses the raw screener text output into structured data.
 */

export interface ParsedMarketWeather {
  omxsValue: number;
  perf5d: number;
  perf1m: number;
  perf3m: number;
  rsi: number;
  trendLabel: string;
}

export interface ParsedCandidate {
  dataQuality?: CandidateDataQuality;
  category: "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST";
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
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  oneR: number;
}

export interface ParsedSession {
  dataAsOf?: string | null;
  dataWarnings?: string[];
  date: string; // YYYY-MM-DD
  marketWeather: ParsedMarketWeather;
  candidates: ParsedCandidate[];
}

export class ScreenerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenerParseError";
  }
}

/**
 * Telegram and chat clients sometimes replace ASCII separators with box-drawing
 * characters and collapse adjacent lines when copying a code block. Normalize
 * those presentation differences before parsing, while keeping the original
 * raw text untouched in the stored session.
 */
function normalizeScreenerText(rawText: string): string {
  return rawText
    .replace(/\r\n?/g, "\n")
    .replace(/═{2,}/g, "===")
    .replace(/(?<!\n)(?=={3,}\s*\d+\s*[·•])/g, "\n")
    .replace(/(?<!\n)(?=(?:={3,}\s*)?\d+\.\s+[A-ZÅÄÖ])/g, "\n")
    .replace(/(?<!\n)\s*(?=plan\((?:LONG|SHORT)\):)/g, "\n")
    .replace(/\n{2,}/g, "\n");
}

/**
 * Extracts the date from the screener text.
 * Looks for "SCREENER · YYYY-MM-DD" or "SCREENER · YYYY-MM-DD" or similar patterns.
 */
function parseDate(text: string): string {
  const dateMatch = text.match(/SCREENER\s*[·•]\s*(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    throw new ScreenerParseError("Could not find date in screener text (expected format: SCREENER · YYYY-MM-DD)");
  }
  return dateMatch[1];
}

/**
 * Parses the market weather line.
 * Example: "MARKNADSVÄDER  OMXS30 3305.0 | 5d    2.7% | 1m    1.8% | 3m    8.9% | RSI  79"
 */
function parseMarketWeather(text: string): ParsedMarketWeather {
  // Match the OMXS30 line
  const mwMatch = text.match(
    /OMXS30\s+([\d.]+)\s*\|\s*5d\s+([-\d.]+)%\s*\|\s*1m\s+([-\d.]+)%\s*\|\s*3m\s+([-\d.]+)%\s*\|\s*RSI\s+([\d.]+)/
  );
  if (!mwMatch) {
    throw new ScreenerParseError("Could not parse market weather line");
  }

  // Extract trend label from the arrow line (→ MEDVIND or → MOTVIND etc.)
  const trendMatch = text.match(/→\s*([A-ZÅÄÖ]+(?:\s+[A-ZÅÄÖ]+)*)/);
  const trendLabel = trendMatch ? trendMatch[1].trim() : "OKÄNT";

  return {
    omxsValue: parseFloat(mwMatch[1]),
    perf5d: parseFloat(mwMatch[2]),
    perf1m: parseFloat(mwMatch[3]),
    perf3m: parseFloat(mwMatch[4]),
    rsi: parseFloat(mwMatch[5]),
    trendLabel,
  };
}

type Category = "MOMENTUM" | "SQUEEZE" | "STUDS" | "WEAKEST";

/**
 * Parses a single candidate line and its plan line.
 * Example candidate line:
 *   "1. SSAB             102.85 | RS3m   18.5 | 1m    9.4% | RSI   57 | %B  0.90 | ATR    3.3% | vol  0.2x | ↔20dH   -0.3%"
 * Optional gap warning at end: "  ⚠ gap +3.4%"
 * Example plan line:
 *   "      plan(LONG): entry ~102.85 · stop 98.83 (1.2×ATR) · mål +1% 103.88 (R/R 0.26) · 1R 106.87"
 */
function parseCandidate(
  candidateLine: string,
  planLine: string,
  category: Category,
  rank: number
): ParsedCandidate {
  // Parse candidate data line
  // Pattern: "N. TICKER   PRICE | RS3m   X | 1m    X% | RSI   X | %B  X | ATR    X% | vol  Xx | ↔20dH   X%  [⚠ gap X%]"
  const dataMatch = candidateLine.match(
    /\d+\.\s+(.+?)\s+([\d.]+)\s*\|\s*RS3m\s+([-\d.]+)\s*\|\s*1m\s+([-\d.]+)%\s*\|\s*RSI\s+([\d.]+)\s*\|\s*%B\s+([-\d.]+)\s*\|\s*ATR\s+([\d.]+)%\s*\|\s*vol\s+([\d.]+)x\s*\|\s*\S*20dH\s+([-\d.]+)%/
  );

  if (!dataMatch) {
    throw new ScreenerParseError(`Could not parse candidate data line: "${candidateLine.trim()}"`);
  }

  const ticker = dataMatch[1].trim();
  const price = parseFloat(dataMatch[2]);
  const rs3m = parseFloat(dataMatch[3]);
  const perf1m = parseFloat(dataMatch[4]);
  const rsi = parseFloat(dataMatch[5]);
  const pctB = parseFloat(dataMatch[6]);
  const atr = parseFloat(dataMatch[7]);
  const volMultiplier = parseFloat(dataMatch[8]);
  const distFrom20dH = parseFloat(dataMatch[9]);

  // Check for gap warning
  const gapMatch = candidateLine.match(/⚠\s*gap\s*([-+][\d.]+)%/);
  const gapWarning = gapMatch ? parseFloat(gapMatch[1]) : null;

  // Parse plan line.
  // Old format: "plan(LONG): entry ~X · stop X (1.2×ATR) · mål +1% X (R/R X) · 1R X"
  // New format: "plan(LONG): entry ~X · stop X (1.2×ATR) · mål X (2×ATR, R/R X) · max N dagar"
  const planMatch = planLine.match(
    /plan\((LONG|SHORT)\):\s*entry\s*~?([\d.]+)\s*·\s*stop\s+([\d.]+)[^·]*·\s*mål\s*~?(?:[+\-\d.]+%\s*)?([\d.]+).*?R\/R\s+([\d.]+)/
  );

  if (!planMatch) {
    throw new ScreenerParseError(`Could not parse plan line: "${planLine.trim()}"`);
  }

  const direction = planMatch[1] as "LONG" | "SHORT";
  const entryPrice = parseFloat(planMatch[2]);
  const stopPrice = parseFloat(planMatch[3]);
  const targetPrice = parseFloat(planMatch[4]);
  const oneR = Math.abs(entryPrice - stopPrice);
  const reward = direction === "SHORT" ? entryPrice - targetPrice : targetPrice - entryPrice;
  const rr = oneR > 0 && reward > 0 ? reward / oneR : 0;

  return {
    category,
    rank,
    ticker,
    price,
    rs3m,
    perf1m,
    rsi,
    pctB,
    atr,
    volMultiplier,
    distFrom20dH,
    gapWarning,
    direction,
    entryPrice,
    stopPrice,
    targetPrice,
    rr,
    oneR,
  };
}

/**
 * Main parser function. Parses the full raw screener text.
 */
export function parseScreenerText(rawText: string): ParsedSession {
  const normalizedText = normalizeScreenerText(rawText);
  const date = parseDate(normalizedText);
  const marketWeather = parseMarketWeather(normalizedText);

  const candidates: ParsedCandidate[] = [];

  // Map section headers to category enums
  const sectionMap: Record<string, Category> = {
    "MOMENTUM": "MOMENTUM",
    "SQUEEZE": "SQUEEZE",
    "STUDS": "STUDS",
    "SVAGAST": "WEAKEST",
  };

  const lines = normalizedText.split("\n");
  let currentCategory: Category | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect category section headers
    // Pattern: "=== N · CATEGORY — description ==="
    const sectionMatch = line.match(/===\s*\d+\s*[·•]\s*([A-ZÅÄÖ]+)/);
    if (sectionMatch) {
      const sectionKey = sectionMatch[1].toUpperCase();
      currentCategory = sectionMap[sectionKey] ?? null;
      continue;
    }

    if (!currentCategory) continue;

    // Only treat ranked, ticker-shaped entries as candidates. This avoids
    // interpreting numbered prose or headings as candidates, while catching
    // malformed data lines when they still look like a ticker row.
    const candidateLineMatch = line.match(/^\s*(\d+)\.\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9.-]*)(?=\s|$)(.*)$/);
    if (candidateLineMatch) {
      const rank = parseInt(candidateLineMatch[1], 10);
      const ticker = candidateLineMatch[2];
      // Next line should be the plan line
      const planLine = lines[i + 1] ?? "";
      const looksLikeCandidate = planLine.includes("plan(")
        || candidateLineMatch[3].includes("|")
        || /^\s+\d+(?:\.\d+)?(?:\s|$)/.test(candidateLineMatch[3]);
      if (!looksLikeCandidate) continue; // e.g. a numbered heading or prose
      if (!planLine.includes("plan(")) {
        throw new ScreenerParseError(
          `Line ${i + 1} (${ticker}): candidate is missing its plan line`,
        );
      }

      try {
        const candidate = parseCandidate(line, planLine, currentCategory, rank);
        candidates.push(candidate);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid candidate";
        throw new ScreenerParseError(`Line ${i + 1} (${ticker}): ${detail}`);
      }
      i++; // skip plan line
    }
  }

  if (candidates.length === 0) {
    throw new ScreenerParseError("No candidates found in screener text. Please check the format.");
  }

  let quality: ReturnType<typeof textReportQuality>;
  try {
    quality = textReportQuality(rawText, date, candidates.map(c => c.ticker));
  } catch (error) {
    throw new ScreenerParseError(error instanceof Error ? error.message : "Rapportens datakvalitet kan inte verifieras.");
  }
  for (const candidate of candidates) candidate.dataQuality = quality.byTicker.get(candidate.ticker);
  return { date, marketWeather, candidates, dataAsOf: quality.dataAsOf, dataWarnings: quality.warnings };
}
