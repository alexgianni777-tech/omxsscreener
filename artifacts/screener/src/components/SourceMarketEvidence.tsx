import React from "react";
import type { SessionSourceReport } from "@workspace/api-client-react";
import { d1Freshness, signalSessionDate } from "@workspace/market-calendar";
import { advisoryTrend, evidenceText } from "../lib/sourceMarketEvidence";

/** These are frozen report observations, never a live index quote. */
export function SourceMarketEvidence({ receipt }: { receipt: SessionSourceReport }) {
  return <div className="mt-1 space-y-1">
    {(receipt.source === "telegram" ? ["SE"] as const : ["SE", "US"] as const).map(market => {
      const snapshot = receipt.marketContext?.[market];
      const index = snapshot?.indexSnapshot;
      const weather = snapshot?.weather;
      const date = snapshot?.dataAsOf ?? null;
      const freshness = d1Freshness(date, signalSessionDate(new Date(), market), market).status;
      const close = index?.close;
      const validIndex = typeof close === "number" && Number.isFinite(close) && close > 0 &&
        typeof index?.source === "string" && !!index.source.trim() &&
        index.asOf === date && index.priceType === "COMPLETED_DAILY_CLOSE";
      const trend = advisoryTrend([receipt], market);
      return <div key={market} className="break-words" data-testid={`source-market-${receipt.source}-${market}`}>
        <p><strong>{market === "SE" ? "Sverige" : "USA"}</strong> · historiskt rapportunderlag / D−1, ej live
          {" · "}datadag {date ?? "okänd"} · {freshness}</p>
        {receipt.source === "telegram" ? <p>Telegram OMXS30 {evidenceText(weather?.omxsValue)} · RSI {evidenceText(weather?.rsi)}
          {" · "}indexregim {evidenceText(weather?.trendLabel)}</p>
          : <><p>EdgeAI indexstängning {validIndex ? evidenceText(close) : "okänd"}
            {index && !validIndex && " · CONFLICT/ej verifierad indexsnapshot"}
            {" · "}källa {evidenceText(index?.source)} · as-of {evidenceText(index?.asOf)}
            {" · "}hämtad {evidenceText(index?.fetchedAt)}</p>
            <p>marketTrendV2: {trend.status} · {trend.reason} · datum {trend.date ?? "okänt"}
              {" · "}riktning {trend.direction} · bredd {trend.breadth} · stress {trend.stress}</p></>}
        {!snapshot && <p>Historiskt källväder saknas i detta äldre kvitto; återställs inte från en annan källa.</p>}
      </div>;
    })}
    {receipt.source === "telegram" && <p>Telegram är en svensk rapport; amerikansk marknadsdag tillhandahålls inte och USA-synkning jämförs inte.</p>}
    {receipt.source === "edgeai" && <p>Trend är rådgivande, inte bevisad edge eller entrygodkännande. RESEARCH ONLY och övriga spärrar gäller oförändrat.</p>}
  </div>;
}
