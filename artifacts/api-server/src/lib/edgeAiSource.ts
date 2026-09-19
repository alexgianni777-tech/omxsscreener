const EDGEAI_CONTENTS_API_URL =
  "https://api.github.com/repos/alexgianni777-tech/edgeai/contents/public/data.json?ref=main";
const EDGEAI_RAW_URL =
  "https://raw.githubusercontent.com/alexgianni777-tech/edgeai/main/public/data.json";

const WARN_EDGEAI_DATA_AGE_MS = 30 * 60 * 60 * 1_000;
const MAX_EDGEAI_IMPORT_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

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