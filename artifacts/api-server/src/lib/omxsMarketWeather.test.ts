import assert from "node:assert/strict";
import test from "node:test";
import { fetchOmxsMarketWeather } from "./omxsMarketWeather";

test("today's EdgeAI uses the last completed index day, not today's partial bar", async () => {
  let requestedEnd: Date | undefined;
  const yf = {
    historical: async (_ticker: string, options: { period2: Date }) => {
      requestedEnd = options.period2;
      // Include a current-day partial bar even if a provider disregards period2.
      return [
        ...Array.from({ length: 30 }, (_, index) => ({
          date: new Date(Date.UTC(2026, 7, 27 + index)),
          close: 3000 + index,
        })),
        { date: new Date("2026-09-28T00:00:00Z"), close: 9999 },
      ];
    },
  };

  const weather = await fetchOmxsMarketWeather(yf, "2026-09-25");
  assert.equal(requestedEnd?.toISOString(), "2026-09-26T00:00:00.000Z");
  assert.equal(weather.omxsValue, 3029);
  assert.ok(weather.marketRsi >= 0 && weather.marketRsi <= 100);
});

test("a missing exact index close does not silently substitute an older bar", async () => {
  const yf = {
    historical: async () => [
      { date: new Date("2026-09-24T00:00:00Z"), close: 3200 },
      { date: new Date("2026-09-28T00:00:00Z"), close: 3300 },
    ],
  };

  await assert.rejects(
    fetchOmxsMarketWeather(yf, "2026-09-25"),
    /OMXS30 closed daily bar missing.*2026-09-25/,
  );
  await assert.rejects(fetchOmxsMarketWeather(yf, "2026-09-31"), /Invalid EdgeAI SE dataAsOf/);
});