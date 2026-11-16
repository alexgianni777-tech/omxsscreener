import { expectedCompletedMarketDay, validMarketDate } from "@workspace/market-calendar";

export type EdgeMarketKey = "SE" | "US";
export type EdgeMarketStatus =
  | "CURRENT"
  | "CURRENT_CACHED"
  | "STALE"
  | "FUTURE_DATA"
  | "UNVERIFIED"
  | "INVALID_DATA";

export type EdgeMarketInput = {
  dataAsOf?: unknown;
  dataStatus?: unknown;
  indexSnapshot?: {
    source?: unknown;
    close?: unknown;
    asOf?: unknown;
    fetchedAt?: unknown;
  } | null;
  setups?: unknown;
};

export type EdgeMarketAssessment = {
  market: EdgeMarketKey;
  expected: string | null;
  actual: string | null;
  snapshotAsOf: string | null;
  source: string | null;
  fetchedAt: string | null;
  status: EdgeMarketStatus;
  fresh: boolean;
  cached: boolean;
  reason: string;
};

export type EdgeAiMarketStatus = Record<EdgeMarketKey, EdgeMarketAssessment>;

export function isValidPublicationTime(value: unknown, now = new Date()): value is string {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now.getTime() + 5 * 60_000;
}

export function assessEdgeMarket(
  market: EdgeMarketKey,
  input: EdgeMarketInput | null | undefined,
  now = new Date(),
): EdgeMarketAssessment {
  const expected = expectedCompletedMarketDay(now, market);
  const actual = validMarketDate(input?.dataAsOf) ? input.dataAsOf : null;
  const snapshot = input?.indexSnapshot;
  const snapshotAsOf = validMarketDate(snapshot?.asOf) ? snapshot.asOf : null;
  const source = typeof snapshot?.source === "string" && snapshot.source.trim()
    ? snapshot.source.trim()
    : null;
  const fetchedAt = isValidPublicationTime(snapshot?.fetchedAt, now) ? snapshot.fetchedAt : null;
  const cached = input?.dataStatus === "CURRENT_CACHED";
  const base = {
    market,
    expected,
    actual,
    snapshotAsOf,
    source,
    fetchedAt,
    cached,
  };
  const result = (
    status: EdgeMarketStatus,
    reason: string,
    fresh = false,
  ): EdgeMarketAssessment => ({ ...base, status, reason, fresh });

  if (!input || typeof input !== "object") return result("UNVERIFIED", "MARKET_DATA_MISSING");
  if (!expected) return result("UNVERIFIED", "EXCHANGE_CALENDAR_UNAVAILABLE");
  if (!actual) return result("UNVERIFIED", "DATA_AS_OF_MISSING_OR_INVALID");
  if (actual > expected) return result("FUTURE_DATA", "DATA_AS_OF_AFTER_EXPECTED_SESSION");
  if (actual < expected) return result("STALE", "DATA_AS_OF_BEFORE_EXPECTED_SESSION");
  if (!snapshot) return result("UNVERIFIED", "INDEX_SNAPSHOT_MISSING");
  if (!snapshotAsOf || snapshotAsOf !== actual) return result("UNVERIFIED", "INDEX_SNAPSHOT_DATE_MISMATCH");
  if (!source) return result("UNVERIFIED", "INDEX_SNAPSHOT_SOURCE_MISSING");
  if (typeof snapshot.close !== "number" || !Number.isFinite(snapshot.close) || snapshot.close <= 0) {
    return result("UNVERIFIED", "INDEX_SNAPSHOT_CLOSE_INVALID");
  }
  if (!isValidPublicationTime(snapshot.fetchedAt, now)) {
    return result("UNVERIFIED", "INDEX_SNAPSHOT_FETCH_TIME_INVALID");
  }
  if (input.dataStatus === "STALE") return result("STALE", "UPSTREAM_MARKET_STATUS_STALE");
  if (
    input.dataStatus != null &&
    input.dataStatus !== "CURRENT" &&
    input.dataStatus !== "CURRENT_CACHED"
  ) {
    return result("UNVERIFIED", "UPSTREAM_MARKET_STATUS_UNKNOWN");
  }
  return result(cached ? "CURRENT_CACHED" : "CURRENT", cached ? "VERIFIED_SOURCE_CACHE" : "VERIFIED", true);
}

export function assessEdgeMarkets(
  markets: { SE?: EdgeMarketInput | null; US?: EdgeMarketInput | null } | null | undefined,
  now = new Date(),
): EdgeAiMarketStatus {
  return {
    SE: assessEdgeMarket("SE", markets?.SE, now),
    US: assessEdgeMarket("US", markets?.US, now),
  };
}

export function importableMarkets(status: EdgeAiMarketStatus): EdgeMarketKey[] {
  return (["SE", "US"] as const).filter((market) => status[market].fresh);
}

export function edgeMarketWarning(assessment: EdgeMarketAssessment): string {
  const actual = assessment.actual ?? "saknas";
  const expected = assessment.expected ?? "okänd";
  return `${assessment.market}: ${assessment.reason} (dataAsOf ${actual}, förväntad handelsdag ${expected}).`;
}
