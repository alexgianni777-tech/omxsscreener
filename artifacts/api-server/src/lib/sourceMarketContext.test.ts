import assert from "node:assert/strict";
import test from "node:test";
import { screenerSessionsTable } from "@workspace/db";
import { makeImportReport } from "./importReport";
import { sourceMarketContext } from "./sourceMarketContext";
import { synchronizeCandidates } from "./candidateSynchronization";
import { latestSourceReceipts } from "./sourceReportStatus";
import { parseScreenerText } from "./screenerParser";

const telegram = {
  date: "2026-11-06", dataAsOf: "2026-11-05",
  marketWeather: { omxsValue: 3300, rsi: 55, perf5d: 1, perf1m: 2, perf3m: 3, trendLabel: "MEDVIND" },
};
const index = { symbol: "^OMX", source: "YAHOO_FINANCE", priceType: "COMPLETED_DAILY_CLOSE", close: 3301.09, asOf: "2026-11-05", fetchedAt: "2026-11-06T07:00:00Z" };
const edgeai = {
  generatedAt: "2026-11-06T07:00:00Z",
  markets: {
    SE: { dataAsOf: "2026-11-05", indexSnapshot: index,
      marketTrendV2: { status: "BULLISH", dataAsOf: "2026-11-05", direction: "UP", breadth: 65, stress: false } },
    US: { dataAsOf: "2026-11-04", indexSnapshot: { ...index, symbol: "^GSPC", close: 7353.73, asOf: "2026-11-04" } },
  },
};
const reports = [
  makeImportReport("telegram", telegram.date, telegram, null, { SE: "2026-11-05", US: null }),
  makeImportReport("edgeai", "2026-11-06", edgeai, edgeai.generatedAt, { SE: "2026-11-05", US: "2026-11-04" }),
];

test("both real synchronization orders persist independent receipt weather without touching recorded trades", async () => {
  const outcomes = [];
  for (const order of [reports, [...reports].reverse()]) {
    const session = { date: "2026-11-06", sourceReports: [] as unknown[], top3SnapshotAt: new Date("2026-11-06T06:00:00Z") };
    const history = [{ id: 7, ticker: "RECORDED", market: "SE", signalSource: "telegram",
      signalDate: "2026-11-05", category: "MOMENTUM", direction: "LONG", outcome: "WIN", realizedR: 2, entryPrice: 100, stopPrice: 95, targetPrice: 110 }];
    const before = structuredClone(history);
    const tx: any = {
      select: () => {
        let selected: unknown;
        const query: any = {
          from(table: unknown) { selected = table; return query; },
          where() { return query; },
          orderBy() { return query; },
          then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve(selected === screenerSessionsTable ? [session] : history).then(resolve, reject);
          },
        };
        return query;
      },
      update: (table: unknown) => ({
        set: (values: object) => ({ where: async () => {
          assert.equal(table, screenerSessionsTable, "no historical candidate mutation");
          Object.assign(session, values);
        }}),
      }),
      insert: () => { throw new Error("No candidate insert expected"); },
      delete: () => { throw new Error("No history deletion expected"); },
    };
    for (const report of order) {
      await synchronizeCandidates(tx, 1, [], new Date("2026-11-06T08:00:00Z"), report);
    }
    assert.deepEqual(history, before);
    const receipts = latestSourceReceipts([session]);
    outcomes.push(Object.fromEntries(receipts.map(r => [r.source, r.marketContext])));
    assert.deepEqual(receipts.find(r => r.source === "telegram")?.dataDates, { SE: "2026-11-05", US: null });
    const count = session.sourceReports.length;
    const retry = await synchronizeCandidates(tx, 1, [], new Date("2026-11-06T08:01:00Z"), order[0]);
    assert.equal(retry.duplicateReport, true);
    assert.equal(session.sourceReports.length, count);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
  assert.equal(outcomes[0].telegram?.SE?.weather?.omxsValue, 3300);
  assert.equal(outcomes[0].edgeai?.SE?.indexSnapshot?.close, 3301.09);
  assert.equal(outcomes[0].telegram?.US, undefined);
});

test("legacy receipts stay unknown; optional trend is preserved only as independent source evidence", () => {
  assert.equal(sourceMarketContext({ date: "2026-11-06" }, "telegram"), undefined);
  assert.equal(sourceMarketContext({ ...telegram }, "legacy"), undefined);
  const original = JSON.stringify(edgeai);
  const context = sourceMarketContext(edgeai, "edgeai");
  assert.equal(context?.SE?.marketTrendV2?.status, "BULLISH");
  assert.equal(context?.US?.marketTrendV2, undefined);
  assert.equal(context?.US?.dataAsOf, "2026-11-04");
  assert.equal(JSON.stringify(edgeai), original);
});

test("Telegram report day and explicitly named D-1 closing day remain different; contradictions reject", () => {
  const raw = `SCREENER · 2026-11-06
Rapport baserad på 2026-11-05-stängningen
MARKNADSVÄDER OMXS30 3300.0 | 5d 1.0% | 1m 2.0% | 3m 3.0% | RSI 55
=== 1 · MOMENTUM ===
1. TEST 100.00 | RS3m 1.0 | 1m 1.0% | RSI 55 | %B 0.50 | ATR 2.0% | vol 1.1x | ↔20dH -1.0%
plan(LONG): entry ~100.00 · stop 95.00 · mål 110.00 (R/R 2.00)`;
  const parsed = parseScreenerText(raw);
  assert.equal(parsed.date, "2026-11-06");
  assert.equal(parsed.dataAsOf, "2026-11-05");
  const report = makeImportReport("telegram", parsed.date, parsed, null, { SE: parsed.dataAsOf!, US: null });
  assert.equal(report.marketContext?.SE?.dataAsOf, "2026-11-05");
  assert.equal(report.marketContext?.US, undefined);
  assert.throws(() => parseScreenerText(`${raw}\ndatadag: 2026-11-04`), /Motstridiga/);
  assert.equal(parseScreenerText(raw.replace("Rapport baserad på 2026-11-05-stängningen", "")).dataAsOf, null);
});
