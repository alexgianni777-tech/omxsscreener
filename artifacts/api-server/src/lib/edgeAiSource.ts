const EDGEAI_RAW_DATA_URL =
  "https://raw.githubusercontent.com/alexgianni777-tech/edgeai/main/public/data.json";

const MAX_EDGEAI_DATA_AGE_MS = 4 * 24 * 60 * 60 * 1_000;

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
  if (ageMs > MAX_EDGEAI_DATA_AGE_MS) {
    const ageDays = Math.floor(ageMs / 86_400_000);
    throw new EdgeAiDataFreshnessError(
      `EdgeAI data is ${ageDays} days old and will not be imported as a current session`,
      generatedAt,
    );
  }

  return data;
}

export function edgeAiDirection(value: unknown): "LONG" | "SHORT" {
  return String(value ?? "").trim().toLowerCase() === "short" ? "SHORT" : "LONG";
}