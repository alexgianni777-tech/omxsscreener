import {
  expectedCompletedMarketDay,
  signalSessionDate,
  previousMarketDay,
} from "@workspace/market-calendar";
import {
  isOmxs30ResearchOnlyCandidate,
  normalizedOmxs30Ticker,
  omxs30Members,
  OMXS30_SCOPE_START,
  SKF_VERTEVO_TICKER,
} from "./omxs30Scope";
import { resolveYahooTicker } from "./omxs30TickerMap";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const REPORT_CACHE_MS = 15 * 60_000;
const RANKING_CACHE_MAX_AGE_MS = 60 * 60_000;
const REQUEST_DELAY_MS = 750;
const REQUEST_TIMEOUT_MS = 10_000;

export type CoverageRowStatus = "READY" | "STALE" | "MISSING" | "PARTIAL" | "NOT_TESTED";
export type CoverageStatus = CoverageRowStatus | "BLOCKED" | "EVENT_ONLY";

export type CoverageOhlcv = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type Omxs30CoverageRow = {
  ticker: string;
  actualYahooSymbol: string | null;
  status: CoverageRowStatus;
  httpStatus: number | null;
  dataAsOf: string | null;
  latestAvailableDate: string | null;
  checkedAt: string;
  ohlcv: CoverageOhlcv | null;
  rankEligible: boolean;
  reason: string | null;
};

export type Omxs30CoverageReport = {
  provider: "Yahoo Finance Chart API (inofficiell/experimentell)";
  decisionDate: string;
  expectedDataAsOf: string | null;
  generatedAt: string;
  status: "READY" | "PARTIAL" | "BLOCKED";
  rankingEligible: boolean;
  index: Omxs30CoverageRow;
  expectedMemberCount: number;
  validMemberCount: number;
  staleCount: number;
  missingCount: number;
  partialCount: number;
  notTestedCount: number;
  members: Omxs30CoverageRow[];
  researchOnly: Array<{
    ticker: string;
    actualYahooSymbol: string;
    status: "EVENT_ONLY";
    rankEligible: false;
    reason: string;
  }>;
  notice: string;
};

type ChartPayload = {
  chart?: {
    error?: { description?: string; code?: string } | null;
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        exchangeName?: string;
        exchangeTimezoneName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
      events?: {
        splits?: Record<string, unknown>;
        capitalGains?: Record<string, unknown>;
        spinoffs?: Record<string, unknown>;
      };
    }> | null;
  };
};

type CachedChart = {
  payload: ChartPayload;
  etag: string | null;
  lastModified: string | null;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function stockholmDateFromEpoch(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validOhlcv(
  values: [number | null | undefined, number | null | undefined, number | null | undefined,
    number | null | undefined, number | null | undefined],
  allowUnknownVolume: boolean,
): CoverageOhlcv | null {
  const [open, high, low, close, volume] = values;
  if ([open, high, low, close].some((value) =>
    typeof value !== "number" || !Number.isFinite(value) || value <= 0,
  )) return null;
  if (high! < low! || open! < low! || open! > high! || close! < low! || close! > high!) return null;
  if (volume != null && (!Number.isFinite(volume) || volume < 0)) return null;
  if (!allowUnknownVolume && (typeof volume !== "number" || volume <= 0)) return null;
  return { open: open!, high: high!, low: low!, close: close!, volume: volume ?? null };
}

function chartResult(payload: ChartPayload) {
  return payload.chart?.result?.[0] ?? null;
}

function lastAvailableDate(payload: ChartPayload): string | null {
  const result = chartResult(payload);
  const dates = (result?.timestamp ?? [])
    .map(stockholmDateFromEpoch)
    .filter((date): date is string => date != null)
    .sort();
  return dates.at(-1) ?? null;
}

function makeRow(
  ticker: string,
  actualYahooSymbol: string | null,
  status: CoverageRowStatus,
  expectedDataAsOf: string | null,
  checkedAt: string,
  options: {
    httpStatus?: number | null;
    latestAvailableDate?: string | null;
    ohlcv?: CoverageOhlcv | null;
    reason?: string | null;
  } = {},
): Omxs30CoverageRow {
  const dataAsOf = status === "READY" ? expectedDataAsOf : null;
  return {
    ticker,
    actualYahooSymbol,
    status,
    httpStatus: options.httpStatus ?? null,
    dataAsOf,
    latestAvailableDate: options.latestAvailableDate ?? null,
    checkedAt,
    ohlcv: options.ohlcv ?? null,
    rankEligible: status === "READY",
    reason: options.reason ?? null,
  };
}

function evaluatePayload(
  ticker: string,
  requestedSymbol: string,
  payload: ChartPayload,
  httpStatus: number,
  expectedDataAsOf: string | null,
  checkedAt: string,
  isIndex: boolean,
): Omxs30CoverageRow {
  const result = chartResult(payload);
  if (!result || !expectedDataAsOf) {
    const error = payload.chart?.error?.description;
    return makeRow(ticker, result?.meta?.symbol ?? null, "MISSING", expectedDataAsOf, checkedAt, {
      httpStatus,
      latestAvailableDate: result ? lastAvailableDate(payload) : null,
      reason: error ?? (expectedDataAsOf ? "Yahoo saknade chart-resultat." : "Börskalendern kunde inte fastställa senaste avslutade session."),
    });
  }

  const meta = result.meta;
  const actualYahooSymbol = typeof meta?.symbol === "string" ? meta.symbol : null;
  const metaValid = actualYahooSymbol?.toUpperCase() === requestedSymbol.toUpperCase() &&
    meta?.currency === "SEK" &&
    meta?.exchangeTimezoneName === "Europe/Stockholm";
  if (!metaValid) {
    return makeRow(ticker, actualYahooSymbol, "PARTIAL", expectedDataAsOf, checkedAt, {
      httpStatus,
      latestAvailableDate: lastAvailableDate(payload),
      reason: `Instrumentmetadata verifierades inte (symbol ${actualYahooSymbol ?? "saknas"}, valuta ${meta?.currency ?? "saknas"}, tidszon ${meta?.exchangeTimezoneName ?? "saknas"}).`,
    });
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) {
    return makeRow(ticker, actualYahooSymbol, "MISSING", expectedDataAsOf, checkedAt, {
      httpStatus,
      latestAvailableDate: lastAvailableDate(payload),
      reason: "OHLCV-serie saknas.",
    });
  }

  const datedRows = timestamps.map((timestamp, index) => ({
    date: stockholmDateFromEpoch(timestamp),
    values: [
      quote.open?.[index],
      quote.high?.[index],
      quote.low?.[index],
      quote.close?.[index],
      quote.volume?.[index],
    ] as [number | null | undefined, number | null | undefined, number | null | undefined,
      number | null | undefined, number | null | undefined],
  })).filter((row) => row.date != null);
  const exact = datedRows.find((row) => row.date === expectedDataAsOf);
  const completedRows = datedRows.filter((row) => row.date! <= expectedDataAsOf);
  const latestAvailableDate = completedRows.map((row) => row.date!).sort().at(-1) ?? null;
  if (!exact) {
    const hasEarlier = completedRows.length > 0;
    const hasOnlyFuture = datedRows.some((row) => row.date! > expectedDataAsOf) && !hasEarlier;
    return makeRow(ticker, actualYahooSymbol, hasOnlyFuture ? "PARTIAL" : hasEarlier ? "STALE" : "MISSING",
      expectedDataAsOf, checkedAt, {
        httpStatus,
        latestAvailableDate,
        reason: hasOnlyFuture
          ? `Exakt D−1 ${expectedDataAsOf} saknas; endast senare stapel returnerades.`
          : hasEarlier
            ? `Exakt D−1 ${expectedDataAsOf} saknas; senaste serien är äldre (${latestAvailableDate}).`
            : `Exakt D−1 ${expectedDataAsOf} saknas i Yahoo-serien.`,
      });
  }

  const ohlcv = validOhlcv(exact.values, isIndex);
  if (!ohlcv) {
    return makeRow(ticker, actualYahooSymbol, "PARTIAL", expectedDataAsOf, checkedAt, {
      httpStatus,
      latestAvailableDate,
      reason: isIndex
        ? "Indexets OHLC är ogiltig; volym kan saknas eller vara noll."
        : "Aktiens D−1-OHLCV är ofullständig eller innehåller ogiltiga värden.",
    });
  }

  const actionMap = result.events;
  const actionDates = [
    ...Object.values(actionMap?.splits ?? {}),
    ...Object.values(actionMap?.capitalGains ?? {}),
    ...Object.values(actionMap?.spinoffs ?? {}),
  ].map((event) => {
    const timestamp = typeof event === "object" && event != null && "date" in event
      ? Number((event as { date?: unknown }).date)
      : Number.NaN;
    return stockholmDateFromEpoch(timestamp);
  }).filter((date): date is string => date != null);
  let actionWindowStart = expectedDataAsOf;
  for (let session = 0; session < 5; session++) {
    actionWindowStart = previousMarketDay(actionWindowStart, "SE") ?? actionWindowStart;
  }
  if (actionDates.some((date) => date <= expectedDataAsOf && (!actionWindowStart || date >= actionWindowStart))) {
    return makeRow(ticker, actualYahooSymbol, "PARTIAL", expectedDataAsOf, checkedAt, {
      httpStatus,
      latestAvailableDate,
      reason: "Yahoo rapporterade en split-/kapitalhändelse nära D−1; serien lämnas overifierad utan att justera historiska signaler.",
    });
  }

  return makeRow(ticker, actualYahooSymbol, "READY", expectedDataAsOf, checkedAt, {
    httpStatus,
    latestAvailableDate,
    ohlcv,
  });
}

function notTestedRow(ticker: string, expectedDataAsOf: string | null, reason: string, checkedAt: string) {
  return makeRow(ticker, null, "NOT_TESTED", expectedDataAsOf, checkedAt, { reason });
}

function makeReport(
  decisionDate: string,
  expectedDataAsOf: string | null,
  generatedAt: string,
  index: Omxs30CoverageRow,
  members: Omxs30CoverageRow[],
): Omxs30CoverageReport {
  const validMemberCount = members.filter((row) => row.status === "READY").length;
  const staleCount = members.filter((row) => row.status === "STALE").length;
  const missingCount = members.filter((row) => row.status === "MISSING").length;
  const partialCount = members.filter((row) => row.status === "PARTIAL").length;
  const notTestedCount = members.filter((row) => row.status === "NOT_TESTED").length;
  const rankingEligible = index.status === "READY" && validMemberCount === members.length;
  const status = index.status !== "READY"
    ? "BLOCKED"
    : rankingEligible
      ? "READY"
      : "PARTIAL";
  const researchOnly = isOmxs30ResearchOnlyCandidate("SE", SKF_VERTEVO_TICKER, decisionDate)
    ? [{
        ticker: SKF_VERTEVO_TICKER,
        actualYahooSymbol: SKF_VERTEVO_TICKER,
        status: "EVENT_ONLY" as const,
        rankEligible: false as const,
        reason: "Tillfälligt indexevent 26–30 nov 2026; saknar verifierad handlingsbar Yahoo-historik och ska inte rankas. Historiska signaler ändras inte.",
      }]
    : [];
  return {
    provider: "Yahoo Finance Chart API (inofficiell/experimentell)",
    decisionDate,
    expectedDataAsOf,
    generatedAt,
    status,
    rankingEligible,
    index,
    expectedMemberCount: members.length,
    validMemberCount,
    staleCount,
    missingCount,
    partialCount,
    notTestedCount,
    members,
    researchOnly,
    notice: "D−1 jämförs exakt för index och aktier. Yahoo-data är inofficiell och inte garanterad; datalicens/redistribution är inte verifierad. Ingen äldre kurs används som ersättning.",
  };
}

export function createOmxs30CoverageService(options: {
  fetchImpl?: FetchLike;
  now?: () => Date;
  delay?: (ms: number) => Promise<void>;
  cacheMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const nowFn = options.now ?? (() => new Date());
  const delay = options.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cacheMs = options.cacheMs ?? REPORT_CACHE_MS;
  const chartCache = new Map<string, CachedChart>();
  let reportCache: { report: Omxs30CoverageReport; expiresAt: number } | null = null;
  let inFlight: Promise<Omxs30CoverageReport> | null = null;

  async function fetchRow(
    ticker: string,
    symbol: string,
    expectedDataAsOf: string | null,
    isIndex: boolean,
  ): Promise<{ row: Omxs30CoverageRow; stop: boolean }> {
    const checkedAt = nowFn().toISOString();
    const cached = chartCache.get(symbol);
    const headers = new Headers({ Accept: "application/json" });
    if (cached?.etag) headers.set("If-None-Match", cached.etag);
    if (cached?.lastModified) headers.set("If-Modified-Since", cached.lastModified);
    const url = new URL(`${encodeURIComponent(symbol)}`, YAHOO_CHART_BASE);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("range", "1mo");
    url.searchParams.set("events", "div,splits");
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        row: makeRow(ticker, cached?.payload.chart?.result?.[0]?.meta?.symbol ?? null,
          cached ? "STALE" : "MISSING", expectedDataAsOf, checkedAt, {
            latestAvailableDate: cached ? lastAvailableDate(cached.payload) : null,
            reason: `Yahoo-anrop misslyckades: ${error instanceof Error ? error.message : "okänt nätverksfel"}.`,
          }),
        stop: true,
      };
    }

    if (response.status === 304) {
      if (!cached) {
        return { row: makeRow(ticker, null, "MISSING", expectedDataAsOf, checkedAt, {
          httpStatus: 304,
          reason: "Yahoo svarade 304 men ingen lokal serie finns att återanvända.",
        }), stop: false };
      }
      return {
        row: evaluatePayload(ticker, symbol, cached.payload, 304, expectedDataAsOf, checkedAt, isIndex),
        stop: false,
      };
    }

    if (!response.ok) {
      const status = response.status === 404 ? "MISSING" : cached ? "STALE" : "MISSING";
      return {
        row: makeRow(ticker, cached?.payload.chart?.result?.[0]?.meta?.symbol ?? null,
          status, expectedDataAsOf, checkedAt, {
            httpStatus: response.status,
            latestAvailableDate: cached ? lastAvailableDate(cached.payload) : null,
            reason: response.status === 404
              ? "Yahoo returnerade 404; ingen annan dag eller symbol används som reserv."
              : `Yahoo HTTP ${response.status}; serien är ${cached ? "stale och inte rankningsbar" : "saknas"}.`,
          }),
        stop: response.status === 403 || response.status === 429 || response.status >= 500,
      };
    }

    let payload: ChartPayload;
    try {
      payload = await response.json() as ChartPayload;
    } catch {
      return {
        row: makeRow(ticker, null, "PARTIAL", expectedDataAsOf, checkedAt, {
          httpStatus: response.status,
          reason: "Yahoo-svaret var inte giltig JSON.",
        }),
        stop: false,
      };
    }
    chartCache.set(symbol, {
      payload,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    });
    return {
      row: evaluatePayload(ticker, symbol, payload, response.status, expectedDataAsOf, checkedAt, isIndex),
      stop: false,
    };
  }

  async function generate(now = nowFn()): Promise<Omxs30CoverageReport> {
    const decisionDate = signalSessionDate(now, "SE");
    const expectedDataAsOf = expectedCompletedMarketDay(now, "SE");
    const members = [...omxs30Members(decisionDate)].sort();
    const generatedAt = nowFn().toISOString();
    const noCalendar = expectedDataAsOf == null;
    const index = noCalendar
      ? makeRow("^OMX", null, "MISSING", null, generatedAt, {
          reason: "Börskalendern kunde inte fastställa senaste avslutade svenska handelssession.",
        })
      : null;
    if (noCalendar) {
      const rows = members.map((ticker) => notTestedRow(ticker, null, "Ingen verifierad D−1-session; inga Yahoo-anrop gjordes.", generatedAt));
      return makeReport(decisionDate, null, generatedAt, index!, rows);
    }

    const tickers = ["^OMX", ...members];
    const rows: Omxs30CoverageRow[] = [];
    let stopped = false;
    let stopReason = "";
    for (let indexNumber = 0; indexNumber < tickers.length; indexNumber++) {
      const ticker = tickers[indexNumber];
      if (stopped) {
        rows.push(notTestedRow(ticker, expectedDataAsOf, stopReason, nowFn().toISOString()));
        continue;
      }
      if (indexNumber > 0) await delay(REQUEST_DELAY_MS);
      const isIndex = ticker === "^OMX";
      const yahooSymbol = isIndex ? ticker : resolveYahooTicker(ticker, "SE");
      const fetched = await fetchRow(ticker, yahooSymbol, expectedDataAsOf, isIndex);
      rows.push(fetched.row);
      if (fetched.stop) {
        stopped = true;
        stopReason = fetched.row.httpStatus === 429
          ? "Inte testad: Yahoo svarade HTTP 429; återstående symboler lämnades utan anrop."
          : fetched.row.httpStatus === 403
            ? "Inte testad: Yahoo svarade HTTP 403; återstående symboler lämnades utan anrop."
            : "Inte testad: Yahoo-anropet misslyckades; återstående symboler lämnades utan anrop.";
      }
    }
    const indexRow = rows[0];
    const memberRows = rows.slice(1);
    return makeReport(decisionDate, expectedDataAsOf, nowFn().toISOString(), indexRow, memberRows);
  }

  return {
    async getCoverage(now = nowFn()): Promise<Omxs30CoverageReport> {
      if (reportCache && now.getTime() < reportCache.expiresAt &&
        reportCache.report.decisionDate === signalSessionDate(now, "SE")) return reportCache.report;
      if (inFlight) return inFlight;
      inFlight = generate(now).then((report) => {
        reportCache = { report, expiresAt: now.getTime() + cacheMs };
        return report;
      }).finally(() => { inFlight = null; });
      return inFlight;
    },
    rankingBlocker(
      market: string | null | undefined,
      ticker: string,
      decisionDate: string,
      expectedDataAsOf: string,
      now = nowFn(),
    ): string | null {
      const report = reportCache?.report;
      if (!report || market !== "SE" || decisionDate < OMXS30_SCOPE_START ||
        report.decisionDate !== decisionDate || report.expectedDataAsOf !== expectedDataAsOf) return null;
      const generatedAt = Date.parse(report.generatedAt);
      if (!Number.isFinite(generatedAt) || now.getTime() < generatedAt ||
        now.getTime() - generatedAt > RANKING_CACHE_MAX_AGE_MS) return null;
      if (report.index.status !== "READY") {
        return `OMXS30 D−1-täckningen är blockerad: index ^OMX är ${report.index.status} för ${expectedDataAsOf}.`;
      }
      const canonicalTicker = normalizedOmxs30Ticker(ticker);
      const row = report.members.find((member) =>
        normalizedOmxs30Ticker(member.ticker) === canonicalTicker,
      );
      if (!row || row.status !== "READY") {
        return `OMXS30 D−1-täckningen är ${row?.status ?? "MISSING"} för ${ticker} (${expectedDataAsOf}); kandidaten rankas inte.`;
      }
      return null;
    },
  };
}

const defaultService = createOmxs30CoverageService();

export function getOmxs30DailyCoverage(now = new Date()): Promise<Omxs30CoverageReport> {
  return defaultService.getCoverage(now);
}

/** A recent failed provider check can only remove a candidate from ranking. */
export function omxs30CoverageRankingBlocker(
  market: string | null | undefined,
  ticker: string,
  decisionDate: string,
  expectedDataAsOf: string,
  now = new Date(),
): string | null {
  return defaultService.rankingBlocker(market, ticker, decisionDate, expectedDataAsOf, now);
}
