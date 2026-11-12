import { d1Freshness, signalSessionDate } from "@workspace/market-calendar";
import type { SessionSourceReport } from "@workspace/api-client-react";

export type Market = "SE" | "US";
export function latestAccepted(reports: readonly SessionSourceReport[], source: string) {
  return reports.filter(r => r.source === source && r.status === "SUCCESS")
    .slice().sort((a, b) => a.importedAt.localeCompare(b.importedAt)).at(-1);
}
const record = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
export const evidenceText = (v: unknown): string => {
  if (typeof v === "boolean") return v ? "ja" : "nej";
  if (typeof v === "number" && Number.isFinite(v)) return v.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
  if (typeof v === "string" && v.trim()) return v;
  const obj = record(v);
  if (obj) return Object.entries(obj).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 6).map(([key, value]) => `${key}: ${evidenceText(value)}`).join(" · ") || "okänd";
  return "okänd";
};
const validDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T12:00:00Z`)) &&
  new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

/** Advisory only. No values returned here participate in selection or entry guards. */
export function advisoryTrend(reports: readonly SessionSourceReport[], market: Market, now = new Date()) {
  const snapshot = latestAccepted(reports, "edgeai")?.marketContext?.[market];
  const trend = record(snapshot?.marketTrendV2);
  const date = trend?.dataAsOf ?? trend?.asOf;
  const state = typeof trend?.status === "string" ? trend.status.toUpperCase()
    : typeof trend?.regime === "string" ? trend.regime.toUpperCase() : "UNKNOWN";
  const freshness = validDay(date) ? d1Freshness(date, signalSessionDate(now, market), market).status : "UNKNOWN";
  const sameDay = validDay(date) && date === snapshot?.dataAsOf;
  const known = ["BULLISH", "BEARISH", "NEUTRAL", "STRESS", "UNKNOWN"].includes(state);
  return {
    status: trend && sameDay && freshness === "CURRENT" && known ? state : "UNKNOWN",
    date: validDay(date) ? date : null,
    reason: !trend ? "saknas" : !sameDay ? "CONFLICT/okänt datum" : freshness !== "CURRENT" ? `${freshness} – ej aktuell` : !known ? "okänt format" : "rådgivande",
    direction: evidenceText(trend?.direction ?? trend?.trendDirection),
    breadth: evidenceText(trend?.breadth),
    stress: evidenceText(trend?.stress),
  };
}
export function trendAlignment(reports: readonly SessionSourceReport[], market: string, direction: string, dataDate: string | null, now = new Date()) {
  if (market !== "SE" && market !== "US") return "avvakta";
  const trend = advisoryTrend(reports, market, now);
  if (!dataDate || trend.date !== dataDate || ["UNKNOWN", "NEUTRAL", "STRESS"].includes(trend.status)) return "avvakta";
  return (trend.status === "BULLISH" && direction === "LONG") || (trend.status === "BEARISH" && direction === "SHORT") ? "med trend" : "mot trend";
}
