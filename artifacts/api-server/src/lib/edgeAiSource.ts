const EDGEAI_RAW_DATA_URL =
  "https://raw.githubusercontent.com/alexgianni777-tech/edgeai/main/public/data.json";

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
 * GitHub Pages may keep data.json cached after EdgeAI has committed fresh data.
 * Fetch the canonical repository file with a cache-busting query instead, then
 * refuse to turn an old signal file into a new daily session.
 */
export async function fetchFreshEdgeAiData(timeoutMs: number): Promise<any> {
  const response = await fetch(`${EDGEAI_RAW_DATA_URL}?v=${Date.now()}`, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
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
    const ageDays = Math.floor(ageMs / 86_400_000);
    throw new EdgeAiDataFreshnessError(
      `EdgeAI data is from ${generatedDate} (${ageDays} days old) and will not be imported as today's session`,
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