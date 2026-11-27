import assert from "node:assert/strict";
import test from "node:test";
import { omxs30Members } from "./omxs30Scope.ts";
import { createOmxs30CoverageService } from "./omxs30DataCoverage.ts";

const checkAt = new Date("2026-11-26T11:56:00.000Z"); // 12:56 in Stockholm; Nov 26 is still open.
const expectedD1 = "2026-11-25";

function chartPayload(symbol: string, options: {
  dates?: string[];
  staleDate?: string;
  currentClose?: number;
  splitDate?: string;
  index?: boolean;
} = {}) {
  const dates = options.dates ?? [expectedD1, "2026-11-26"];
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          currency: "SEK",
          exchangeName: "Stockholm",
          exchangeTimezoneName: "Europe/Stockholm",
        },
        timestamp: dates.map((date) => Math.floor(new Date(`${date}T12:00:00.000Z`).getTime() / 1000)),
        indicators: {
          quote: [{
            open: dates.map((date) => date === expectedD1 && options.staleDate ? null : 100),
            high: dates.map((date) => date === "2026-11-26" ? 120 : 110),
            low: dates.map(() => 90),
            close: dates.map((date) => date === "2026-11-26" ? options.currentClose ?? 115 : 105),
            volume: dates.map((date) => date === "2026-11-26" ? 0 : options.index ? 0 : 1000),
          }],
        },
        ...(options.splitDate ? {
          events: {
            splits: {
              event: {
                date: Math.floor(new Date(`${options.splitDate}T12:00:00.000Z`).getTime() / 1000),
                numerator: 2,
                denominator: 1,
              },
            },
          },
        } : {}),
      }],
      error: null,
    },
  };
}

function yahooResponse(symbol: string, options: Parameters<typeof chartPayload>[1] = {}) {
  return Response.json(chartPayload(symbol, options), {
    headers: { etag: `etag-${symbol}` },
  });
}

function chartSymbol(input: string | URL): string {
  return decodeURIComponent(new URL(input).pathname.split("/").at(-1) ?? "");
}

test("D−1 coverage uses the last completed Stockholm session and ignores the partial current bar", async () => {
  const requested: string[] = [];
  const delays: number[] = [];
  const service = createOmxs30CoverageService({
    now: () => checkAt,
    delay: async (ms) => { delays.push(ms); },
    fetchImpl: async (input) => {
      const symbol = chartSymbol(input);
      requested.push(symbol);
      return yahooResponse(symbol, { index: symbol === "^OMX" });
    },
  });

  const report = await service.getCoverage(checkAt);
  assert.equal(report.decisionDate, "2026-11-26");
  assert.equal(report.expectedDataAsOf, expectedD1);
  assert.equal(report.index.status, "READY");
  assert.equal(report.index.ohlcv?.volume, 0, "index volume can be zero");
  assert.equal(report.expectedMemberCount, 30);
  assert.equal(report.validMemberCount, 30);
  assert.equal(report.status, "READY");
  assert.equal(report.rankingEligible, true);
  assert.equal(report.members.find((row) => row.ticker === "INVE-B.ST")?.dataAsOf, expectedD1);
  assert.equal(report.members.find((row) => row.ticker === "INVE-B.ST")?.ohlcv?.close, 105,
    "the 26 Nov partial bar must not replace the 25 Nov close");
  assert.equal(requested.length, 31, "index plus 30 dated members are requested once, serially");
  assert.ok(delays.every((delay) => delay === 750));
  assert.equal(report.researchOnly[0]?.ticker, "SKFVER-B.ST");
  assert.equal(report.researchOnly[0]?.rankEligible, false);
});

test("29/30 coverage remains explicit and the missing member is excluded from ranking", async () => {
  const missingTicker = "ATCO-A.ST";
  const service = createOmxs30CoverageService({
    now: () => checkAt,
    delay: async () => {},
    fetchImpl: async (input) => {
      const symbol = chartSymbol(input);
      if (symbol === missingTicker) {
        return yahooResponse(symbol, { dates: ["2026-11-24", "2026-11-26"] });
      }
      return yahooResponse(symbol, { index: symbol === "^OMX" });
    },
  });

  const report = await service.getCoverage(checkAt);
  assert.equal(report.validMemberCount, 29);
  assert.equal(report.staleCount, 1);
  assert.equal(report.members.find((row) => row.ticker === missingTicker)?.status, "STALE");
  assert.equal(report.members.find((row) => row.ticker === missingTicker)?.latestAvailableDate, "2026-11-24",
    "today's partial bar must not be reported as the latest completed fallback date");
  assert.equal(report.members.find((row) => row.ticker === missingTicker)?.ohlcv, null);
  assert.equal(report.rankingEligible, false);
  assert.equal(service.rankingBlocker("SE", "ATCO-A", "2026-11-26", expectedD1, checkAt)?.includes("rankas inte"), true);
  assert.equal(service.rankingBlocker("SE", "INVE-B", "2026-11-26", expectedD1, checkAt), null);
  assert.equal(service.rankingBlocker("SE", "INVE-B", "2026-11-27", expectedD1, checkAt), null,
    "a report for another decision day is not reused");
});

test("conditional requests reuse validated cached bodies; a nearby split is partial, not adjusted", async () => {
  const requests: Array<{ symbol: string; etag: string | null }> = [];
  let secondPass = false;
  const service = createOmxs30CoverageService({
    now: () => checkAt,
    delay: async () => {},
    cacheMs: 0,
    fetchImpl: async (input, init) => {
      const symbol = chartSymbol(input);
      const headers = new Headers(init?.headers);
      requests.push({ symbol, etag: headers.get("If-None-Match") });
      if (secondPass) return new Response(null, { status: 304 });
      return yahooResponse(symbol, {
        index: symbol === "^OMX",
        ...(symbol === "INVE-B.ST" ? { splitDate: expectedD1 } : {}),
      });
    },
  });

  const first = await service.getCoverage(checkAt);
  assert.equal(first.members.find((row) => row.ticker === "INVE-B.ST")?.status, "PARTIAL");
  assert.match(first.members.find((row) => row.ticker === "INVE-B.ST")?.reason ?? "", /split-/);
  assert.equal(first.members.find((row) => row.ticker === "INVE-B.ST")?.ohlcv, null);
  secondPass = true;
  const second = await service.getCoverage(checkAt);
  assert.equal(second.members.find((row) => row.ticker === "ATCO-A.ST")?.status, "READY");
  assert.ok(requests.slice(31).every((request) => request.etag === `etag-${request.symbol}`));
  assert.equal(omxs30Members("2026-12-01").has("SOBI.ST"), true);
  assert.equal(omxs30Members("2026-12-01").has("LIFCO-B.ST"), false);
});

test("Yahoo 429 stops the serial run and leaves unrequested symbols explicitly untested", async () => {
  let calls = 0;
  const service = createOmxs30CoverageService({
    now: () => checkAt,
    delay: async () => {},
    fetchImpl: async () => {
      calls++;
      return new Response("rate limited", { status: 429 });
    },
  });
  const report = await service.getCoverage(checkAt);
  assert.equal(calls, 1);
  assert.equal(report.index.httpStatus, 429);
  assert.equal(report.index.status, "MISSING");
  assert.equal(report.notTestedCount, 30);
  assert.equal(report.members[0]?.status, "NOT_TESTED");
  assert.equal(report.rankingEligible, false);
});
