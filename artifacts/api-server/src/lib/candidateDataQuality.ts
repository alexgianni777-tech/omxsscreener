import type { CandidateDataQuality } from "@workspace/db";

const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
const bool = (v: unknown) => typeof v === "boolean" ? v : null;

export function edgeAiDataQuality(setup: Record<string, unknown>, dataAsOf: string | null = null): CandidateDataQuality {
  const evidenceStatus = text(setup.evidenceStatus);
  const eliteStatus = text(setup.eliteStatus);
  const eliteQualified = bool(setup.eliteQualified);
  const validatedEdge = bool(setup.validatedEdge);
  const reasons: string[] = [];
  if (evidenceStatus === "WATCH" || eliteStatus === "RESEARCH_ONLY" || eliteQualified === false || validatedEdge === false) {
    reasons.push("RESEARCH ONLY – upstream kvalificerar inte denna setup för entry.");
  } else if (eliteQualified !== true || validatedEdge !== true ||
    !["VALIDATED", "ELITE", "QUALIFIED"].includes(evidenceStatus ?? "") ||
    !["ELITE", "QUALIFIED", "QUALIFIED_OOS"].includes(eliteStatus ?? "")) {
    reasons.push("Upstream-kvalificering är okänd – ingen verifierad entry.");
  }
  if (!dataAsOf) reasons.push("Verifierad marknadsdag saknas.");
  return {
    source: "edgeai", dataAsOf, evidenceStatus, eliteStatus, eliteQualified, validatedEdge,
    barSource: "UNKNOWN", fullSessionVerified: false,
    entryEligible: reasons.length === 0, reasons,
  };
}

/**
 * This parser can prove only what the report explicitly says. A summary count
 * without ticker identities affects the whole report conservatively, not a
 * guessed subset. No claim of an official close is inferred from silence.
 */
export function textReportQuality(raw: string, reportDate: string, tickers: string[]) {
  const dates = [...raw.matchAll(/(?:dataAsOf|datadag|dataDate|marknadsdag)\s*(?:[:=·]|är)?\s*(\d{4}-\d{2}-\d{2})/gi),
    ...raw.matchAll(/(?:baserad|baserat|baserade)\s+på\s+(\d{4}-\d{2}-\d{2})(?:-|\s+)(?:stängning|stängningen|stängningskurser)/gi)]
    .map(match => match[1]);
  const validDates = [...new Set(dates)].filter(d =>
    new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d && d <= reportDate);
  if (validDates.length > 1 || validDates.length !== new Set(dates).size) {
    throw new Error("Motstridiga eller ogiltiga marknadsdatum i rapporten.");
  }
  const dataAsOf = validDates[0] ?? null;
  const repaired = new Set([...raw.matchAll(/\bREPAIRED_INTRADAY\s+([A-Z0-9.^_-]+)/gi)]
    .map(match => match[1].toUpperCase().replace(/\.ST$/, "")));
  const summary = /dagsstaplar rekonstruerade|rekonstruerad[e]?\s+(?:från\s+)?intradagsdata/i.test(raw);
  const repairCount = Number(raw.match(/(\d+)\s+dagsstaplar rekonstruerade/i)?.[1] ?? 0);
  const unscopedRepair = summary && repaired.size === 0 ||
    repairCount > repaired.size || repaired.has("^OMX") ||
    /\bREPAIRED_INTRADAY\b/.test(raw) && repaired.size === 0;
  const warnings: string[] = [];
  if (!dataAsOf) warnings.push("Rapportens faktiska marknadsdag saknas; rapportdag är inte prisdag.");
  if (summary || repaired.size) warnings.push("REPAIRED_INTRADAY – rekonstruerat underlag, fullständig handelsdag är inte verifierad.");
  const byTicker = new Map(tickers.map(ticker => {
    const reconstructed = unscopedRepair || repaired.has(ticker.toUpperCase().replace(/\.ST$/, ""));
    const reasons = [
      ...(!dataAsOf ? ["Verifierad marknadsdag saknas."] : []),
      ...(reconstructed ? ["REPAIRED_INTRADAY – öppning, stängning och fullständig handelsdag ej verifierade; ingen entrybekräftelse."] : []),
    ];
    const quality: CandidateDataQuality = {
      source: "telegram", dataAsOf, evidenceStatus: null, eliteStatus: null,
      eliteQualified: null, validatedEdge: null,
      barSource: reconstructed ? "RECONSTRUCTED_INTRADAY" : "UNKNOWN",
      fullSessionVerified: false, entryEligible: reasons.length === 0, reasons,
    };
    return [ticker, quality] as const;
  }));
  return { dataAsOf, warnings, byTicker };
}
