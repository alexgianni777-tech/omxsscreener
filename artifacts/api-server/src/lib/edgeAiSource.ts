import { isAcceptedSignalDate, stockholmSignalDate } from "./signalDatePolicy";
import { isE2ETestMode } from "./e2eTestSafety";
import { isZonedTimestamp, validateEdgeAiPayload, type EdgeAiPayloadQuality } from "./edgeAiValidation";
import { GitHubContentsClient } from "./githubContents";

const EDGEAI_CONTENTS_API_URL =
  "https://api.github.com/repos/alexgianni777-tech/edgeai/contents/public/data.json?ref=main";
const contentsClient = new GitHubContentsClient(EDGEAI_CONTENTS_API_URL);

export type EdgeAiFetchResult = {
  data: any;
  rawData: unknown;
  quality: EdgeAiPayloadQuality;
};

export class EdgeAiDataFreshnessError extends Error {
  public readonly generatedAt: string | null;

  constructor(
    message: string,
    generatedAt: string | null,
  ) {
    super(message);
    this.name = "EdgeAiDataFreshnessError";
    this.generatedAt = generatedAt;
  }
}

/**
 * raw.githubusercontent.com can keep serving yesterday's file after EdgeAI has
 * committed fresh data. Fetch the canonical repository content through GitHub's
 * API instead. Manual and scheduled imports both accept the previous weekday
 * close, retain its actual date, and reject older or future-dated reports.
 */
export async function fetchFreshEdgeAiData(
  timeoutMs: number,
  options: { now?: Date; client?: GitHubContentsClient } = {},
): Promise<EdgeAiFetchResult> {
  if (isE2ETestMode()) {
    throw new Error("External EdgeAI fetch is disabled in isolated E2E_TEST mode.");
  }
  return (options.client ?? contentsClient).load(timeoutMs, raw => validateFetchedData(raw, options.now ?? new Date()),
    result => result.quality.errors.length === 0);
}

function validateFetchedData(raw: unknown, now: Date): EdgeAiFetchResult {
  const data: any = raw;
  const generatedAt = typeof data?.generatedAt === "string" ? data.generatedAt : null;
  const generatedAtMs = isZonedTimestamp(generatedAt) ? Date.parse(generatedAt) : Number.NaN;

  if (!Number.isFinite(generatedAtMs)) {
    throw new EdgeAiDataFreshnessError(
      "EdgeAI response has no valid generatedAt timestamp",
      generatedAt,
    );
  }

  const freshness = edgeAiDataFreshness(data, now);
  const tooFarInFuture = freshness.ageMs < -5 * 60 * 1_000;
  const accepted = isAcceptedSignalDate(edgeAiSessionDate(data), stockholmSignalDate(now));
  if (tooFarInFuture || !accepted) {
    const ageDescription = freshness.ageDescription;
    throw new EdgeAiDataFreshnessError(
      tooFarInFuture
        ? `EdgeAI-data har en framtida tidsstämpel (${generatedDateLabel(generatedAtMs)})`
        : `EdgeAI-data är ${ageDescription} (${generatedDateLabel(generatedAtMs)}). Endast dagens eller föregående handelsdags rapport accepteras.`,
      generatedAt,
    );
  }

  const reportDate = edgeAiSessionDate(data);
  const quality = validateEdgeAiPayload(data, reportDate);
  return { data, rawData: data, quality };
}

function generatedDateLabel(timestamp: number): string {
  return stockholmSignalDate(new Date(timestamp));
}

export function edgeAiDataFreshness(data: { generatedAt?: unknown }, now = new Date()): {
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

  const ageMs = now.getTime() - generatedAtMs;
  const generatedDate = generatedDateLabel(generatedAtMs);
  const currentDate = stockholmSignalDate(now);
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
  return stockholmSignalDate(new Date(timestamp));
}
