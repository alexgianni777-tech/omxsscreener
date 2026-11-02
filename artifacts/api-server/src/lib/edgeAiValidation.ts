import { previousTradingDate } from "./signalDatePolicy";

export type EdgeAiMarket = "SE" | "US";

export function edgeAiDirection(value: unknown): "LONG" | "SHORT" {
  const direction = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (direction === "LONG") return "LONG";
  if (direction === "SHORT") return "SHORT";
  throw new Error(`Ogiltig EdgeAI-riktning: ${JSON.stringify(value)}. Förväntade LONG eller SHORT.`);
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function edgeAiSignalDate(signalT: unknown, market: EdgeAiMarket): string | null {
  if (typeof signalT !== "string" || !signalT.trim()) return null;
  const value = signalT.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT[+-]\d{4})(?:\b|(?=\s|\)|$))/i.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: market === "SE" ? "Europe/Stockholm" : "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Validate fields used to create an actionable equity candidate. */
export function validateEdgeAiSetup(setup: unknown, market: EdgeAiMarket, reportDate?: string): string[] {
  const errors: string[] = [];
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) return ["setup måste vara ett objekt"];
  const row = setup as Record<string, unknown>;
  let direction: "LONG" | "SHORT" | null = null;
  try {
    direction = edgeAiDirection(row.dir);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "ogiltig riktning");
  }

  const ticker = typeof row.ticker === "string" ? row.ticker.trim() : "";
  if (!ticker || !/^[A-Za-z0-9.^_-]+$/.test(ticker)) errors.push("ticker saknas eller har ogiltigt format");
  if (typeof row.setup !== "string" || !row.setup.trim()) errors.push("setup-namn saknas");

  const entry = numberValue(row.entry);
  const stop = numberValue(row.stop);
  const target = numberValue(row.target);
  if (entry == null || entry <= 0) errors.push("entry saknas eller är ogiltig");
  if (stop == null || stop <= 0) errors.push("stop saknas eller är ogiltig");
  if (target == null || target <= 0) errors.push("target saknas eller är ogiltig");
  if (direction && entry != null && stop != null && target != null &&
      ((!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) ||
       (direction === "LONG" && !(stop < entry && entry < target)) ||
       (direction === "SHORT" && !(stop > entry && entry > target)))) {
    errors.push("entry/stop/target stämmer inte med riktningen");
  }

  const signalDate = edgeAiSignalDate(row.signalT, market);
  if (!signalDate) errors.push("signalT saknas eller saknar verifierbar tidszon");
  else if (reportDate && signalDate > reportDate) errors.push(`signalT ${signalDate} ligger efter rapportdagen ${reportDate}`);

  const relativeStrength = numberValue(row.rs);
  if (relativeStrength == null) errors.push("rs saknas eller är ogiltig");
  if (!Number.isInteger(row.barsAgo) || Number(row.barsAgo) < 0) {
    errors.push("barsAgo saknas eller är ogiltigt");
  }

  const edge = row.edge && typeof row.edge === "object" && !Array.isArray(row.edge)
    ? row.edge as Record<string, unknown>
    : null;
  const winRate = numberValue(edge?.winRate);
  if (winRate == null || winRate < 0 || winRate > 100) errors.push("edge.winRate saknas eller ligger utanför 0–100");
  if (numberValue(edge?.expectancyR) == null) errors.push("edge.expectancyR saknas eller är ogiltig");
  const sample = numberValue(edge?.sample ?? edge?.n);
  if (sample == null || !Number.isInteger(sample) || sample < 0) {
    errors.push("edge.sample/edge.n saknas eller är ogiltigt");
  }
  return errors;
}

export type EdgeAiPayloadQuality = {
  reportDate: string;
  dataDates: { SE: string | null; US: string | null };
  errors: string[];
  warnings: string[];
  quarantinedIdentities: string[];
};

/** Validate the report envelope and dates without rewriting any financial plan. */
export function validateEdgeAiPayload(value: unknown, reportDate: string): EdgeAiPayloadQuality {
  const errors: string[] = [];
  const warnings: string[] = [];
  const quarantinedIdentities: string[] = [];
  const dataDates: EdgeAiPayloadQuality["dataDates"] = { SE: null, US: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { reportDate, dataDates, errors: ["GitHub-data måste vara ett JSON-objekt."], warnings, quarantinedIdentities };
  }
  const root = value as Record<string, unknown>;
  const markets = root.markets && typeof root.markets === "object" && !Array.isArray(root.markets)
    ? root.markets as Record<string, unknown>
    : null;
  if (!markets) {
    errors.push("markets saknas eller har fel format.");
    return { reportDate, dataDates, errors, warnings, quarantinedIdentities };
  }

  const presentMarkets = (["SE", "US"] as const).filter((market) => Object.hasOwn(markets, market));
  if (presentMarkets.length === 0) errors.push("markets saknar både SE och US.");
  for (const market of ["SE", "US"] as const) {
    if (!Object.hasOwn(markets, market)) continue;
    const entry = markets[market];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`markets.${market} måste vara ett objekt.`);
      continue;
    }
    const marketData = entry as Record<string, unknown>;
    if (!Array.isArray(marketData.setups)) {
      errors.push(`markets.${market}.setups måste vara en lista.`);
      continue;
    }

    const dataAsOf = marketData.dataAsOf;
    if (dataAsOf != null && !validIsoDate(dataAsOf)) {
      errors.push(`markets.${market}.dataAsOf är inte ett giltigt YYYY-MM-DD-datum.`);
    } else if (typeof dataAsOf === "string") {
      dataDates[market] = dataAsOf;
      if (dataAsOf > reportDate) errors.push(`markets.${market}.dataAsOf ligger efter rapportdagen.`);
      else if (dataAsOf !== previousTradingDate(reportDate)) {
        warnings.push(`${market}: dataAsOf ${dataAsOf} avviker från föregående vardag ${previousTradingDate(reportDate)}; kontrollera börshelgdag och D−1-underlag.`);
      }
    } else if (marketData.setups.length > 0) {
      errors.push(`markets.${market}.dataAsOf saknas trots att marknaden har setups.`);
    } else {
      warnings.push(`${market}: dataAsOf saknas.`);
    }

    for (const [index, setup] of marketData.setups.entries()) {
      const setupErrors = validateEdgeAiSetup(setup, market, reportDate);
      if (setupErrors.length === 0) continue;
      const row = setup && typeof setup === "object" ? setup as Record<string, unknown> : {};
      const label = `${market} ${typeof row.ticker === "string" ? row.ticker : `setup ${index + 1}`}`;
      errors.push(`${label}: ${setupErrors.join("; ")}.`);
      quarantinedIdentities.push(`${market}|${String(row.setup ?? "?")}|${String(row.ticker ?? "?")}|${String(row.dir ?? "?")}|${String(row.signalT ?? "?")}`);
    }
    if (marketData.setups.length > 0) {
      for (const setup of marketData.setups) {
        if (!setup || typeof setup !== "object" || Array.isArray(setup)) continue;
        const edge = (setup as Record<string, unknown>).edge;
        if (!edge || typeof edge !== "object" || Array.isArray(edge)) continue;
        warnings.push(...edgeAiMetricWarnings(edge as Record<string, unknown>));
      }
    }
    if (marketData.setups.length === 0) warnings.push(`${market}: inga setups i rapporten.`);
  }

  return { reportDate, dataDates, errors, warnings, quarantinedIdentities };
}

export function edgeAiSampleN(edge: Record<string, unknown>): number {
  const sample = numberValue(edge.sample ?? edge.n);
  if (sample == null || !Number.isInteger(sample) || sample < 0) {
    throw new Error("EdgeAI sample size is missing or invalid.");
  }
  return sample;
}

export function edgeAiMetricWarnings(edge: Record<string, unknown>): string[] {
  return edgeAiSampleN(edge) === 0 ? ["EdgeAI sample size is 0; historical edge is not established."] : [];
}

