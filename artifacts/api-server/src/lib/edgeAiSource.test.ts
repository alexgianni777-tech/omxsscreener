import assert from "node:assert/strict";
import test from "node:test";
import { expectedCompletedMarketDay, signalSessionDate } from "@workspace/market-calendar";
import { edgeAiSessionDate, fetchFreshEdgeAiData, EdgeAiDataFreshnessError, verifiedSetupsForImport } from "./edgeAiSource";
import { assessEdgeMarket } from "./edgeAiFreshness";
import { previousTradingDate } from "./signalDatePolicy";
import { GitHubContentsClient } from "./githubContents";

function read(timeout: number, now: Date) {
  return fetchFreshEdgeAiData(timeout, {
    now,
    client: new GitHubContentsClient("https://api.github.com/test"),
  });
}

const asOfMarket = (date: string, generatedAt: string, dataStatus = "CURRENT") => ({
  dataAsOf: date,
  dataStatus,
  setups: [],
  indexSnapshot: {
    source: "Yahoo Finance",
    close: 100,
    asOf: date,
    fetchedAt: generatedAt,
  },
});

const payload = (
  generatedAt: string,
  dates?: { SE?: string; US?: string },
  statuses?: { SE?: string; US?: string },
) => {
  const reportDate = edgeAiSessionDate({ generatedAt });
  const seDate = dates?.SE ?? previousTradingDate(reportDate, "SE");
  const usDate = dates?.US ?? previousTradingDate(reportDate, "US");
  return {
    generatedAt,
    markets: {
      SE: asOfMarket(seDate, generatedAt, statuses?.SE ?? "CURRENT"),
      US: asOfMarket(usDate, generatedAt, statuses?.US ?? "CURRENT"),
    },
  };
};

test("Friday D-1 data is current on Monday morning in both exchange timezones", async (context) => {
  const now = new Date("2026-11-16T08:00:00Z");
  const data = payload("2026-11-14T03:35:14Z", { SE: "2026-11-13", US: "2026-11-13" });
  context.mock.method(globalThis, "fetch", async () => Response.json(data));

  const result = await read(1000, now);
  assert.deepEqual(result.includedMarkets, ["SE", "US"]);
  assert.equal(result.marketStatus.SE.expected, "2026-11-13");
  assert.equal(result.marketStatus.US.expected, "2026-11-13");
  assert.equal(result.marketStatus.SE.fresh, true);
  assert.equal(result.marketStatus.US.fresh, true);
  assert.equal(result.quality.dataDates.SE, "2026-11-13");
  assert.equal(result.quality.dataDates.US, "2026-11-13");
  assert.equal(result.cacheStatus, "FETCHED");
});

test("manual and scheduled imports can only receive setups from verified markets", () => {
  const result = verifiedSetupsForImport({
    data: {
      markets: {
        SE: { setups: [{ ticker: "SCA-B" }] },
        US: { setups: [{ ticker: "W" }] },
      },
    } as any,
    includedMarkets: ["SE"],
  });
  assert.deepEqual(result.SE, [{ ticker: "SCA-B" }]);
  assert.deepEqual(result.US, []);
});

test("older exchange session is stale; one current market can import without the other", async (context) => {
  const now = new Date("2026-11-16T08:00:00Z");
  const data = payload("2026-11-14T03:35:14Z", { SE: "2026-11-13", US: "2026-11-12" });
  context.mock.method(globalThis, "fetch", async () => Response.json(data));

  const result = await read(1000, now);
  assert.deepEqual(result.includedMarkets, ["SE"]);
  assert.equal(result.marketStatus.SE.fresh, true);
  assert.equal(result.marketStatus.US.status, "STALE");
  assert.equal(result.marketStatus.US.reason, "DATA_AS_OF_BEFORE_EXPECTED_SESSION");
  assert.equal(result.quality.dataDates.US, null);
  assert.match(result.quality.warnings.join(" "), /US: DATA_AS_OF_BEFORE_EXPECTED_SESSION/);
});

test("stale data in every market fails the shared source gate used before force handling", async (context) => {
  const now = new Date("2026-11-16T08:00:00Z");
  const data = payload("2026-11-14T03:35:14Z", { SE: "2026-11-12", US: "2026-11-12" });
  context.mock.method(globalThis, "fetch", async () => Response.json(data));

  await assert.rejects(
    read(1000, now),
    (error) => error instanceof EdgeAiDataFreshnessError &&
      error.marketStatus?.SE.status === "STALE" &&
      error.marketStatus?.US.status === "STALE",
  );
});

test("verified EdgeAI source cache is imported with an explicit cache status", async (context) => {
  const now = new Date("2026-11-16T08:00:00Z");
  const data = payload(
    "2026-11-14T03:35:14Z",
    { SE: "2026-11-13", US: "2026-11-13" },
    { SE: "CURRENT_CACHED", US: "CURRENT" },
  );
  context.mock.method(globalThis, "fetch", async () => Response.json(data));

  const result = await read(1000, now);
  assert.deepEqual(result.includedMarkets, ["SE", "US"]);
  assert.equal(result.marketStatus.SE.status, "CURRENT_CACHED");
  assert.equal(result.marketStatus.SE.cached, true);
  assert.equal(result.marketStatus.US.cached, false);
});

test("Saturday generatedAt maps to the next trading session, not Saturday", () => {
  const saturday = new Date("2026-11-14T10:00:00Z");
  assert.equal(edgeAiSessionDate({ generatedAt: saturday.toISOString() }), "2026-11-14");
  assert.equal(signalSessionDate(saturday, "SE"), "2026-11-16");
  assert.equal(signalSessionDate(saturday, "US"), "2026-11-16");
});

test("exchange close buffers are timezone-specific and honor holiday/half-day calendars", () => {
  // 19:00 Stockholm has passed the SE close buffer; New York is still trading.
  const stockholmEvening = new Date("2026-11-16T18:00:00Z");
  assert.equal(expectedCompletedMarketDay(stockholmEvening, "SE"), "2026-11-16");
  assert.equal(expectedCompletedMarketDay(stockholmEvening, "US"), "2026-11-13");

  // At 17:30 New York the US close buffer has passed.
  assert.equal(expectedCompletedMarketDay(new Date("2026-11-16T22:30:00Z"), "US"), "2026-11-16");

  // Thanksgiving and Midsummer closure carry the prior valid completed session.
  assert.equal(expectedCompletedMarketDay(new Date("2026-11-26T16:00:00Z"), "US"), "2026-11-25");
  assert.equal(expectedCompletedMarketDay(new Date("2026-06-22T06:00:00Z"), "SE"), "2026-06-18");

  // The published calendar intentionally fails closed outside its verified range.
  assert.equal(expectedCompletedMarketDay(new Date("2028-01-03T12:00:00Z"), "SE"), null);
});

test("a valid same-day completed close is not warned stale because publication is dated that day", async (context) => {
  const now = new Date("2026-11-16T19:30:00Z"); // after Stockholm settlement buffer, before NY close
  const generatedAt = "2026-11-16T19:00:00Z";
  const data = payload(generatedAt, { SE: "2026-11-16", US: "2026-11-13" });
  context.mock.method(globalThis, "fetch", async () => Response.json(data));

  const result = await read(1000, now);
  assert.deepEqual(result.includedMarkets, ["SE", "US"]);
  assert.equal(result.quality.dataDates.SE, "2026-11-16");
  assert.equal(result.quality.dataDates.US, "2026-11-13");
  assert.ok(!result.quality.warnings.some((warning) => /dataAsOf .* avviker från förväntad handelsdag/.test(warning)));
});

test("market verification requires source, positive close, and a valid non-future fetch timestamp", () => {
  const now = new Date("2026-11-16T08:00:00Z");
  const base = asOfMarket("2026-11-13", "2026-11-14T03:35:14Z");
  assert.equal(assessEdgeMarket("SE", base, now).fresh, true);
  assert.equal(assessEdgeMarket("SE", {
    ...base, indexSnapshot: { ...base.indexSnapshot, source: "" },
  }, now).reason, "INDEX_SNAPSHOT_SOURCE_MISSING");
  assert.equal(assessEdgeMarket("SE", {
    ...base, indexSnapshot: { ...base.indexSnapshot, close: 0 },
  }, now).reason, "INDEX_SNAPSHOT_CLOSE_INVALID");
  assert.equal(assessEdgeMarket("SE", {
    ...base, indexSnapshot: { ...base.indexSnapshot, fetchedAt: "2026-11-17T03:35:14Z" },
  }, now).reason, "INDEX_SNAPSHOT_FETCH_TIME_INVALID");
});

test("missing or inconsistent market proof never qualifies as current", async (context) => {
  const now = new Date("2026-11-16T08:00:00Z");
  const data = payload("2026-11-14T03:35:14Z", { SE: "2026-11-13", US: "2026-11-13" });
  data.markets.US.indexSnapshot.asOf = "2026-11-12";
  data.markets.SE.dataStatus = "STALE";
  context.mock.method(globalThis, "fetch", async () => Response.json(data));

  await assert.rejects(
    read(1000, now),
    (error) => error instanceof EdgeAiDataFreshnessError &&
      error.marketStatus?.SE.status === "STALE" &&
      error.marketStatus?.US.reason === "INDEX_SNAPSHOT_DATE_MISMATCH",
  );
});

test("generatedAt requires a zoned, non-future timestamp but is not used for data age", async (context) => {
  const now = new Date("2026-11-16T08:00:00Z");
  const saturdayData = payload("2026-11-14T03:35:14Z", { SE: "2026-11-13", US: "2026-11-13" });
  context.mock.method(globalThis, "fetch", async () => Response.json(saturdayData));
  assert.deepEqual((await read(1000, now)).includedMarkets, ["SE", "US"]);

  const invalid = new GitHubContentsClient("https://api.github.com/test", async () =>
    Response.json({ ...saturdayData, generatedAt: "2026-11-16T20:00:00Z" }));
  await assert.rejects(fetchFreshEdgeAiData(1000, { now, client: invalid }), EdgeAiDataFreshnessError);

  const noZone = new GitHubContentsClient("https://api.github.com/test", async () =>
    Response.json({ ...saturdayData, generatedAt: "2026-11-14T03:35:14" }));
  await assert.rejects(fetchFreshEdgeAiData(1000, { now, client: noZone }), EdgeAiDataFreshnessError);
});

test("Contents API remains canonical and HTTP failure never falls back to a CDN", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("{}", { status: 503 });
  });
  await assert.rejects(read(1000, new Date("2026-11-16T08:00:00Z")), /no CDN fallback was used/);
  assert.equal(calls, 1);
});
