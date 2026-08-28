const EDGEAI_CONTENTS_API_URL =
  "https://api.github.com/repos/alexgianni777-tech/edgeai/contents/public/data.json?ref=main";

const MAX_EDGEAI_DATA_AGE_MS = 30 * 60 * 60 * 1_000;

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
 * API instead, then refuse to turn an old signal file into a new daily session.
 */
export async function fetchFreshEdgeAiData(timeoutMs: number): Promise<any> {
  const response = await fetch(EDGEAI_CONTENTS_API_URL, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      "Cache-Control": "no-cache",
      "User-Agent": "omxs30-screener",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`EdgeAI fetch HTTP ${response.status}`);
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

  const ageMs = Date.now() - generatedAtMs;
  const generatedDate = new Date(generatedAtMs).toISOString().slice(0, 10);
  const currentDate = new Date().toISOString().slice(0, 10);
  if (ageMs < -5 * 60 * 1_000 || ageMs > MAX_EDGEAI_DATA_AGE_MS || generatedDate !== currentDate) {
    const generatedDayMs = Date.parse(`${generatedDate}T00:00:00.000Z`);
    const currentDayMs = Date.parse(`${currentDate}T00:00:00.000Z`);
    const calendarDaysOld = Math.round((currentDayMs - generatedDayMs) / 86_400_000);
    const ageDescription =
      calendarDaysOld === 1
        ? "från igår"
        : calendarDaysOld > 1
          ? `${calendarDaysOld} kalenderdagar gammal`
          : generatedDate === currentDate
            ? "med en ogiltig tidsstämpel"
            : `från ${generatedDate}`;
    throw new EdgeAiDataFreshnessError(
      `EdgeAI-data är ${ageDescription} (${generatedDate}) och importeras inte som dagens session`,
      generatedAt,
    );
  }

  return data;
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