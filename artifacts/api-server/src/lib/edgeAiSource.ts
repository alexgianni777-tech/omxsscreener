import { stockholmSignalDate } from "./signalDatePolicy";
import { isE2ETestMode } from "./e2eTestSafety";
import { isZonedTimestamp, validateEdgeAiPayload, type EdgeAiPayloadQuality } from "./edgeAiValidation";
import { GitHubContentsClient, type GitHubCacheStatus } from "./githubContents";
import {
  assessEdgeMarkets,
  edgeMarketWarning,
  isValidPublicationTime,
  type EdgeAiMarketStatus,
  type EdgeMarketKey,
} from "./edgeAiFreshness";

const EDGEAI_CONTENTS_API_URL =
  "https://api.github.com/repos/alexgianni777-tech/edgeai/contents/public/data.json?ref=main";
const contentsClient = new GitHubContentsClient(EDGEAI_CONTENTS_API_URL);

export type EdgeAiFetchResult = {
  data: any;
  rawData: unknown;
  quality: EdgeAiPayloadQuality;
  marketStatus: EdgeAiMarketStatus;
  includedMarkets: EdgeMarketKey[];
  cacheStatus: GitHubCacheStatus;
};

export function verifiedSetupsForImport(
  result: Pick<EdgeAiFetchResult, "data" | "includedMarkets">,
): { SE: any[]; US: any[] } {
  const markets = result.data?.markets;
  return {
    SE: result.includedMarkets.includes("SE") && Array.isArray(markets?.SE?.setups)
      ? markets.SE.setups
      : [],
    US: result.includedMarkets.includes("US") && Array.isArray(markets?.US?.setups)
      ? markets.US.setups
      : [],
  };
}

export class EdgeAiDataFreshnessError extends Error {
  public readonly generatedAt: string | null;
  public readonly marketStatus?: EdgeAiMarketStatus;

  constructor(
    message: string,
    generatedAt: string | null,
    marketStatus?: EdgeAiMarketStatus,
  ) {
    super(message);
    this.name = "EdgeAiDataFreshnessError";
    this.generatedAt = generatedAt;
    this.marketStatus = marketStatus;
  }
}

/**
 * raw.githubusercontent.com can keep serving yesterday's file after EdgeAI has
 * committed fresh data. Fetch the canonical repository content through GitHub's
 * API instead. Manual and scheduled imports share the same per-exchange
 * completed-session check; force-reimport cannot bypass this validation.
 */
export async function fetchFreshEdgeAiData(
  timeoutMs: number,
  options: { now?: Date; client?: GitHubContentsClient } = {},
): Promise<EdgeAiFetchResult> {
  if (isE2ETestMode()) {
    throw new Error("External EdgeAI fetch is disabled in isolated E2E_TEST mode.");
  }
  const loaded = await (options.client ?? contentsClient).loadWithStatus(
    timeoutMs,
    (raw) => validateFetchedData(raw, options.now ?? new Date()),
    (result) => result.includedMarkets.length > 0,
  );
  return { ...loaded.value, cacheStatus: loaded.cacheStatus };
}

function validateFetchedData(raw: unknown, now: Date): EdgeAiFetchResult {
  const data: any = raw;
  const generatedAt = typeof data?.generatedAt === "string" ? data.generatedAt : null;
  if (!isZonedTimestamp(generatedAt) || !isValidPublicationTime(generatedAt, now)) {
    throw new EdgeAiDataFreshnessError(
      "EdgeAI response has no valid or non-future generatedAt timestamp",
      generatedAt,
    );
  }

  const reportDate = edgeAiSessionDate(data);
  const marketStatus = assessEdgeMarkets(data?.markets, now);
  const includedMarkets: EdgeMarketKey[] = [];
  const quality: EdgeAiPayloadQuality = {
    reportDate,
    dataDates: { SE: null, US: null },
    errors: [],
    warnings: [],
    quarantinedIdentities: [],
  };

  for (const market of ["SE", "US"] as const) {
    const assessment = marketStatus[market];
    if (!assessment.fresh) {
      quality.warnings.push(edgeMarketWarning(assessment));
      continue;
    }

    // Validate each currently-fresh market independently. Bad or stale data in
    // the other exchange must not be mixed into this import or block good data.
    const marketQuality = validateEdgeAiPayload(data, reportDate, [market]);
    if (marketQuality.errors.length > 0) {
      const reason = marketQuality.errors.join(" ");
      marketStatus[market] = {
        ...assessment,
        status: "INVALID_DATA",
        fresh: false,
        reason: "CURRENT_MARKET_PAYLOAD_INVALID",
      };
      quality.warnings.push(`${market}: aktuellt marknadsdatum men ogiltigt signalunderlag (${reason})`);
      continue;
    }
    includedMarkets.push(market);
    quality.dataDates[market] = marketQuality.dataDates[market];
    quality.warnings.push(...marketQuality.warnings);
    quality.quarantinedIdentities.push(...marketQuality.quarantinedIdentities);
  }

  if (includedMarkets.length === 0) {
    const reason = quality.warnings.length
      ? quality.warnings.join(" ")
      : "EdgeAI saknar verifierade marknadsdata för senaste avslutade handelsdag.";
    throw new EdgeAiDataFreshnessError(reason, generatedAt, marketStatus);
  }

  return { data, rawData: data, quality, marketStatus, includedMarkets, cacheStatus: "FETCHED" };
}

export function edgeAiSessionDate(data: { generatedAt?: unknown }): string {
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : "";
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) {
    throw new EdgeAiDataFreshnessError("EdgeAI response has no valid generatedAt timestamp", generatedAt || null);
  }
  return stockholmSignalDate(new Date(timestamp));
}
