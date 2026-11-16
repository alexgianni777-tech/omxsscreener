export type EdgeMarketStatusView = {
  expected: string | null;
  actual: string | null;
  status: string;
  fresh: boolean;
  cached: boolean;
  reason: string;
  source: string | null;
  fetchedAt: string | null;
};

export type EdgeAIImportMeta = {
  marketStatus?: Partial<Record<"SE" | "US", EdgeMarketStatusView>>;
  includedMarkets?: Array<"SE" | "US">;
  cacheStatus?: "MEMORY_CACHE" | "ETAG_REVALIDATED" | "FETCHED";
};

export function edgeCacheLabel(status?: EdgeAIImportMeta["cacheStatus"]): string {
  switch (status) {
    case "FETCHED": return "GitHub hämtad nu";
    case "ETAG_REVALIDATED": return "GitHub bekräftade oförändrad data via ETag";
    case "MEMORY_CACHE": return "API-minnescache";
    default: return "cache okänd";
  }
}

const REASON_LABELS: Record<string, string> = {
  MARKET_DATA_MISSING: "marknadsdata saknas",
  EXCHANGE_CALENDAR_UNAVAILABLE: "börskalender kan inte verifieras",
  DATA_AS_OF_MISSING_OR_INVALID: "datadatum saknas eller är ogiltigt",
  DATA_AS_OF_AFTER_EXPECTED_SESSION: "datadatum ligger framåt",
  DATA_AS_OF_BEFORE_EXPECTED_SESSION: "data är äldre än senaste avslutade handelsdag",
  INDEX_SNAPSHOT_MISSING: "indexsnapshot saknas",
  INDEX_SNAPSHOT_DATE_MISMATCH: "indexdatum stämmer inte",
  INDEX_SNAPSHOT_SOURCE_MISSING: "indexkälla saknas",
  INDEX_SNAPSHOT_CLOSE_INVALID: "indexstängning är ogiltig",
  INDEX_SNAPSHOT_FETCH_TIME_INVALID: "hämtningstid saknas eller är ogiltig",
  UPSTREAM_MARKET_STATUS_STALE: "EdgeAI markerar marknaden som gammal",
  UPSTREAM_MARKET_STATUS_UNKNOWN: "EdgeAI-status är okänd",
  CURRENT_MARKET_PAYLOAD_INVALID: "signalunderlaget är ogiltigt",
};

export function edgeMarketLabel(market: "SE" | "US", status?: EdgeMarketStatusView): string {
  if (!status) return `${market}: status saknas`;
  const state = status.fresh
    ? status.cached ? "aktuell (EdgeAI-cache)" : "aktuell"
    : `inte importerad (${REASON_LABELS[status.reason] ?? status.reason})`;
  const source = status.source ? ` · källa ${status.source}` : "";
  const fetchedAt = status.fetchedAt ? ` · snapshot hämtad ${status.fetchedAt}` : "";
  return `${market}: ${state} · data ${status.actual ?? "saknas"} · förväntad ${status.expected ?? "okänd"}${source}${fetchedAt}`;
}
