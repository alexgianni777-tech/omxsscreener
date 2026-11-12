import type { SourceMarketContext } from "@workspace/api-zod";
import { validMarketDate } from "@workspace/market-calendar";

const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Receipt-owned evidence only. Never reconstruct an older source from session scalars. */
export function sourceMarketContext(input: unknown, source: string): SourceMarketContext | undefined {
  const body = object(input);
  if (!body) return undefined;
  if (source === "telegram" || source === "manual") {
    const weather = object(body.marketWeather);
    return weather ? { SE: { dataAsOf: typeof body.dataAsOf === "string" ? body.dataAsOf : null, weather: { ...weather } } } : undefined;
  }
  if (source !== "edgeai") return undefined;
  const markets = object(body.markets);
  const rootTrend = object(body.marketTrendV2);
  const result: SourceMarketContext = {};
  for (const market of ["SE", "US"] as const) {
    const data = object(markets?.[market]);
    if (!data) continue;
    const index = object(data.indexSnapshot);
    const trend = object(data.marketTrendV2) ?? object(rootTrend?.[market]);
    result[market] = {
      dataAsOf: typeof data.dataAsOf === "string" ? data.dataAsOf : null,
      ...(index ? { indexSnapshot: { ...index } } : {}),
      ...(trend ? { marketTrendV2: { ...trend } } : {}),
    };
  }
  return result;
}

/** The Swedish session summary has a fixed source policy, never last-writer wins.
 * Telegram/OMXS30 owns that summary when evidenced; EdgeAI is the fallback.
 * Each source's complete original snapshot remains in its receipt.
 */
export function sessionMarketEvidence(session: {
  sourceReports?: unknown; omxsValue?: number; perf5d?: number; perf1m?: number;
  perf3m?: number; marketRsi?: number; trendLabel?: string;
}) {
  const receipts = Array.isArray(session.sourceReports) ? session.sourceReports : [];
  const accepted = receipts.flatMap((receipt: any) => {
    const snapshot = receipt?.marketContext?.SE;
    const weather = snapshot?.weather;
    const priority = ["telegram", "manual", "edgeai"].indexOf(receipt?.source);
    if (priority < 0 || receipt.status !== "SUCCESS" ||
        !validMarketDate(snapshot?.dataAsOf) || snapshot.dataAsOf !== receipt.dataDates?.SE ||
        !validMarketDate(receipt.signalDate) || snapshot.dataAsOf > receipt.signalDate ||
        !Number.isFinite(Date.parse(receipt.importedAt ?? "")) ||
        !weather || !["omxsValue", "perf5d", "perf1m", "perf3m", "rsi"]
          .every(key => typeof weather[key] === "number" && Number.isFinite(weather[key])) ||
        weather.omxsValue <= 0 || weather.rsi < 0 || weather.rsi > 100 ||
        typeof weather.trendLabel !== "string") return [];
    return [{ receipt, snapshot, weather, priority }];
  }).sort((a, b) => a.priority - b.priority ||
    b.snapshot.dataAsOf.localeCompare(a.snapshot.dataAsOf) ||
    String(b.receipt.generatedAt ?? b.receipt.signalDate).localeCompare(String(a.receipt.generatedAt ?? a.receipt.signalDate)) ||
    String(b.receipt.fingerprint).localeCompare(String(a.receipt.fingerprint)));
  const selected = accepted[0];
  const conflicted = selected && accepted.some(other =>
    other.priority === selected.priority &&
    other.snapshot.dataAsOf === selected.snapshot.dataAsOf &&
    String(other.receipt.generatedAt ?? other.receipt.signalDate) === String(selected.receipt.generatedAt ?? selected.receipt.signalDate) &&
    ["omxsValue", "perf5d", "perf1m", "perf3m", "rsi", "trendLabel"]
      .some(key => other.weather[key] !== selected.weather[key]));
  const verified = !!selected && !conflicted;
  const weather = verified ? {
    omxsValue: selected.weather.omxsValue as number,
    perf5d: selected.weather.perf5d as number,
    perf1m: selected.weather.perf1m as number,
    perf3m: selected.weather.perf3m as number,
    rsi: selected.weather.rsi as number,
    trendLabel: `${selected.receipt.source === "edgeai" ? "EdgeAI" : selected.receipt.source === "manual" ? "Manuell rapport" : "Telegram/OMXS30"} · ${selected.snapshot.dataAsOf} · ${selected.weather.trendLabel}`,
  } : {
    omxsValue: session.omxsValue ?? 0, perf5d: session.perf5d ?? 0,
    perf1m: session.perf1m ?? 0, perf3m: session.perf3m ?? 0,
    rsi: session.marketRsi ?? 0,
    trendLabel: conflicted ? "CONFLICT · motstridigt marknadsväder från samma källa och period" :
      "OKÄND KÄLLA · historisk sessionsreferens, ej verifierad",
  };
  return { verified, weather,
    fields: verified ? {
      omxsValue: weather.omxsValue, perf5d: weather.perf5d, perf1m: weather.perf1m,
      perf3m: weather.perf3m, marketRsi: weather.rsi, trendLabel: selected.weather.trendLabel as string,
    } : {},
  };
}
