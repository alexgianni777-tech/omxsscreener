import assert from "node:assert/strict";
import test from "node:test";

import { parseScreenerText, ScreenerParseError } from "./screenerParser.ts";
import { makeImportReport } from "./importReport.ts";
import { synchronizeCandidates } from "./candidateSynchronization.ts";

const header = `SCREENER · 2025-03-14
MARKNADSVÄDER  OMXS30 3305.0 | 5d 2.7% | 1m 1.8% | 3m 8.9% | RSI 79
→ MEDVIND
=== 1 · MOMENTUM — starkast ===`;

const validCandidate = `1. SSAB 102.85 | RS3m 18.5 | 1m 9.4% | RSI 57 | %B 0.90 | ATR 3.3% | vol 0.2x | ↔20dH -0.3%
plan(LONG): entry ~102.85 · stop 98.83 (1.2×ATR) · mål +1% 103.88 (R/R 0.26) · 1R 106.87`;
test("reads the actual producer's common closing-data phrase, never the report date",()=>{
  const raw=`${header}\nRapportdag: 2025-03-14 · all ranking/entry/stop/mål använder gemensam stängningsdata från 2025-03-13.\nDetta är avsiktligt tillåtet.\n${validCandidate}`;
  const p=parseScreenerText(raw);
  assert.equal(p.date,"2025-03-14");
  assert.equal(p.dataAsOf,"2025-03-13");
  assert.equal(p.candidates.length,1);
  assert.equal(p.candidates[0].entryPrice,102.85);
  assert.equal(parseScreenerText(raw.replace(".\nDetta",". Detta")).dataAsOf,"2025-03-13");
  assert.throws(()=>parseScreenerText(raw+"\nDatadag: 2025-03-12"),/Motstridiga/);
  assert.throws(()=>parseScreenerText(raw.replace("2025-03-13.","2025-99-13.")),/ogiltiga/);
});

test("parses a valid candidate while ignoring harmless numbered prose", () => {
  const parsed = parseScreenerText(`${header}
1. MOMENTUM OVERVIEW
${validCandidate}`);

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].ticker, "SSAB");
  assert.equal(parsed.candidates[0].category, "MOMENTUM");
});

test("parses mixed-case company names and ignores numbered footer instructions", () => {
  const parsed = parseScreenerText(`${header}
1. SCA 122.25 | RS3m 22.3 | 1m 7.6% | RSI 69 | %B 0.73 | ATR 1.7% | vol 0.6x | ↔20dH -3.7%
plan(LONG): entry ~122.25 · stop 119.70 (1.2×ATR) · mål 126.50 (2×ATR, R/R 1.67) · max 10 dagar
2. Swedbank 411.00 | RS3m 11.8 | 1m 9.3% | RSI 72 | %B 0.83 | ATR 1.9% | vol 1.4x | ↔20dH -1.2%
plan(LONG): entry ~411.00 · stop 401.86 (1.2×ATR) · mål 426.23 (2×ATR, R/R 1.67) · max 10 dagar
3. Alfa Laval 500.00 | RS3m 10.0 | 1m 3.0% | RSI 55 | %B 0.50 | ATR 2.0% | vol 1.1x | ↔20dH -1.0%
plan(LONG): entry ~500.00 · stop 488.00 (1.2×ATR) · mål 520.00 (2×ATR, R/R 1.67) · max 10 dagar
(Loggade 3 kandidater.)
DIN DEL AV JOBBET:
4. LOGGA varje trade (setup, val, utfall). Efter 20–30 trades: mät resultat.`);

  assert.deepEqual(parsed.candidates.map((candidate) => candidate.ticker), ["SCA", "Swedbank", "Alfa Laval"]);
});

test("fails the whole parse when a candidate among valid rows is malformed", () => {
  const malformedCandidate = `2. VOLVO B 250.00 | broken candidate data
plan(LONG): entry ~250.00 · stop 240.00 · mål 275.00 (R/R 2.50)`;

  assert.throws(
    () => parseScreenerText(`${header}
${validCandidate}
${malformedCandidate}`),
    (error: unknown) => {
      assert.ok(error instanceof ScreenerParseError);
      assert.match(error.message, /Line \d+ \(VOLVO\)/);
      assert.match(error.message, /Could not parse candidate data line/);
      return true;
    },
  );
});

test("fails with an actionable error when a candidate has no plan", () => {
  assert.throws(
    () => parseScreenerText(`${header}
1. SSAB 102.85 | incomplete row`),
    (error: unknown) => {
      assert.ok(error instanceof ScreenerParseError);
      assert.match(error.message, /Line \d+ \(SSAB\)/);
      assert.match(error.message, /missing its plan line/);
      return true;
    },
  );
});

// Regression fixture, not a fetched production report. Boliden's supplied
// levels are exact; other rows exercise section boundaries and pairing.
const novemberReport = `SCREENER · 2026-11-05
datadag: 2026-11-05
MARKNADSVÄDER OMXS30 3305.0 | 5d 2.7% | 1m 1.8% | 3m 8.9% | RSI 79
→ MEDVIND
=== 1 · MOMENTUM — starkast ===
${validCandidate}
${validCandidate.replace("1. SSAB", "2. SCA")}
=== 2 · SQUEEZE — test ===
${validCandidate.replace("SSAB", "NIBE-B")}
=== 3 · STUDS — test ===
${validCandidate.replace("SSAB", "ABB")}
=== 4 · SVAGAST — test ===
1. Boliden 507.60 | RS3m -18.5 | 1m -9.4% | RSI 37 | %B 0.10 | ATR 3.3% | vol 0.2x | ↔20dH -10.3% ⚠ gap +2.3%
plan(SHORT): entry ~507.60 · stop 530.56 · mål 461.67 (R/R 2.00) · max 5 dagar
2. ELUX-B 100.00 | RS3m -10.0 | 1m -3.0% | RSI 35 | %B 0.20 | ATR 2.0% | vol 1.1x | ↔20dH -5.0%
plan(SHORT): entry ~100.00 · stop 104.00 · mål 92.00 (R/R 2.00)
3. ERIC-B 80.00 | RS3m -10.0 | 1m -3.0% | RSI 35 | %B 0.20 | ATR 2.0% | vol 1.1x | ↔20dH -5.0%
plan(SHORT): entry ~80.00 · stop 84.00 · mål 72.00 (R/R 2.00)`;

const fenceReport = novemberReport.replace(
  "\nplan(SHORT): entry ~507.60",
  "\n```\n\n```text\n  plan(SHORT): entry ~507.60",
);

const copyVariants = [
  ["Markdown fences", fenceReport],
  ["inline fences and plan", novemberReport.replace(
    "\nplan(SHORT): entry ~507.60", " ``` plan(SHORT): entry ~507.60")],
  ["CRLF and whitespace", ` \r\n\`\`\`text\r\n${fenceReport.replaceAll("\n", "\r\n  ")}\r\n\`\`\` \r\n `],
  ["literal newline escapes", fenceReport.replaceAll("\n", "\\n")],
  ["literal CRLF escapes", fenceReport.replaceAll("\n", "\\r\\n")],
  ["mixed actual and escaped newlines", fenceReport.replace(
    "```\n\n```text\n", "```\\n\\r\\n```text\\n")],
  ["Markdown hard line breaks", fenceReport.replaceAll("\n", "\\\n")],
  ["wrapped plan fields", fenceReport.replace(
    "· stop 530.56 · mål 461.67 (R/R 2.00)",
    "· stop\n530.56\n· mål 461.67\n(R/R 2.00)")],
] as const;

for (const [name, text] of copyVariants) {
  test(`Telegram copy: ${name} preserves all seven candidates, D-1 and exact plans`, () => {
    const parsed = parseScreenerText(text);
    assert.deepEqual(parsed, parseScreenerText(novemberReport));
    assert.equal(parsed.date, "2026-11-05");
    assert.equal(parsed.dataAsOf, "2026-11-05");
    assert.equal(parsed.candidates.length, 7);
    const boliden = parsed.candidates.find(c => c.ticker === "Boliden")!;
    assert.equal(boliden.category, "WEAKEST");
    assert.equal(boliden.direction, "SHORT");
    assert.equal(boliden.gapWarning, 2.3);
    assert.deepEqual([boliden.entryPrice, boliden.stopPrice, boliden.targetPrice], [507.6, 530.56, 461.67]);
  });
}

test("missing Boliden plan cannot borrow the next candidate's or next section's plan", () => {
  const missing = novemberReport.replace(/^plan\(SHORT\): entry ~507.60.*$/m, "```\n\\n```");
  for (const text of [
    missing,
    missing.replace("2. ELUX-B", "=== 5 · MOMENTUM ===\n2. ELUX-B"),
  ]) {
    assert.throws(() => parseScreenerText(text), /Boliden.*missing its plan line/);
  }
});

test("malformed Boliden plan is still rejected rather than ignored or replaced", () => {
  assert.throws(
    () => parseScreenerText(fenceReport.replace("stop 530.56", "stop saknas")),
    /Boliden.*Could not parse plan line/,
  );
});

test("reimporting differently copied Telegram report is a duplicate and preserves saved trades without writes", async () => {
  const original = parseScreenerText(novemberReport);
  const report = makeImportReport("telegram", original.date, original, null, { SE: original.dataAsOf!, US: null });
  for (const [, text] of copyVariants) {
    const parsed = parseScreenerText(text);
    const retry = makeImportReport("telegram", parsed.date, parsed, null, { SE: parsed.dataAsOf!, US: null });
    assert.equal(retry.fingerprint, report.fingerprint);
    const history = [{ id: 7, ticker: "Boliden", outcome: "WIN", realizedR: 1.5 }];
    const queue = [[], [{ date: original.date, sourceReports: [{ ...report, importedAt: "2026-11-06T08:00:00Z" }] }], history];
    const tx = {
      select: () => ({ from: () => ({ where: async () => queue.shift() }) }),
      update: () => { throw new Error("Unexpected history write"); },
      insert: () => { throw new Error("Unexpected duplicate insert"); },
      delete: () => { throw new Error("Unexpected history deletion"); },
    };
    const result = await synchronizeCandidates(tx, 1, parsed.candidates.map(candidate => ({ ...candidate })), new Date("2026-11-06T09:00:00Z"), retry);
    assert.equal(result.duplicateReport, true);
    assert.deepEqual(result.candidates, history);
    assert.deepEqual(result.diff, { added: [], updated: [], removed: [] });
    assert.equal(queue.length, 0);
  }
});