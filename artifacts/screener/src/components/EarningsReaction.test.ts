import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EarningsReaction, formatPercent, type EarningsReactionData } from "./EarningsReaction";

function reaction(overrides: Partial<EarningsReactionData> = {}): EarningsReactionData {
  return {
    status: "MISSING",
    reportDate: "2026-10-22",
    reportTimestamp: null,
    timezone: "Europe/Stockholm",
    dataAsOf: null,
    previousClose: null,
    reportDay: null,
    changePct: null,
    postReport: [1, 3, 5].map((sessions) => ({
      sessions: sessions as 1 | 3 | 5, date: null, close: null, returnPct: null,
    })),
    reason: "Ingen exakt dagsstapel finns för rapportdagen.",
    priceHistoryStatus: "UNKNOWN",
    marketDataAsOf: null,
    source: "Yahoo Finance",
    ...overrides,
  };
}

function markup(data: EarningsReactionData): string {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(
    QueryClientProvider,
    { client },
    createElement(EarningsReaction, {
      ticker: "TEST",
      yahooTicker: "TEST.ST",
      market: "SE",
      reaction: data,
      pageFetchedAt: "2026-10-29T10:00:00.000Z",
    }),
  ));
}

test("report reaction formatting uses Swedish decimals and rejects non-finite values", () => {
  assert.equal(formatPercent(2.5093167), "2,51%");
  assert.equal(formatPercent(-1.6628787), "−1,66%");
  assert.equal(formatPercent(Number.POSITIVE_INFINITY), "saknas");
  assert.equal(formatPercent(null), "saknas");
});

test("missing report data renders NO DATA and does not fabricate OHLC or timestamps", () => {
  const html = markup(reaction());
  assert.match(html, /NO DATA/);
  assert.match(html, /Ingen exakt dagsstapel/);
  assert.match(html, /tidpunkt ej verifierad/);
  assert.doesNotMatch(html, /Infinity|NaN/);
});

test("stale and conflicting source data remain explicitly visible without calculated prices", () => {
  const html = markup(reaction({
    status: "CONFLICT",
    reason: "OHLC-värdena är oförenliga.",
    priceHistoryStatus: "STALE",
    dataAsOf: "2026-10-27",
    marketDataAsOf: "2026-10-28T10:00:00.000Z",
  }));
  assert.match(html, /CONFLICT/);
  assert.match(html, /STALE/);
  assert.match(html, /Beräknade nivåer visas inte/);
  assert.doesNotMatch(html, /Visa intradagsdiagram/);
});
