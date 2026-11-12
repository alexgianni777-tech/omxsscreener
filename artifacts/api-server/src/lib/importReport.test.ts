import test from "node:test";
import assert from "node:assert/strict";
import { makeImportReport, normalizeImportSymbol } from "./importReport";
import { deduplicateCandidates, synchronizeCandidates } from "./candidateSynchronization";
import { candidateIdentity } from "./candidateSynchronizationPolicy";

test("report version ignores transport timestamps, candidate order, whitespace and Stockholm suffix aliases", () => {
  const report = makeImportReport("edgeai", "2026-10-07", { generatedAt: "first", markets: { SE: { setups: [{ ticker: " hm b ", price: 100 }, { ticker: "AZN", price: 200 }] } } }, "2026-10-08T08:00:00Z", { SE: "2026-10-07", US: null });
  const retry = makeImportReport("edgeai", "2026-10-07", { markets: { SE: { setups: [{ price: 200, ticker: "AZN.ST" }, { price: 100, ticker: "HM-B.ST" }] } }, generatedAt: "second" }, "2026-10-08T09:00:00Z", { SE: "2026-10-07", US: null });
  assert.equal(report.fingerprint, retry.fingerprint);
  assert.equal(report.reportDate, "2026-10-08");
  assert.equal(report.signalDate, "2026-10-07");
  assert.equal(report.dataDates.SE, "2026-10-07");
});
test("different source, source date, financial plan or ordered price series makes a new report version", () => {
  const body = { candidates: [{ ticker: "AZN", entryPrice: 100 }], closes: [90, 100] };
  const base = makeImportReport("telegram", "2026-10-07", body).fingerprint;
  for (const other of [
    makeImportReport("manual", "2026-10-07", body),
    makeImportReport("telegram", "2026-10-08", body),
    makeImportReport("telegram", "2026-10-07", { ...body, closes: [100, 90] }),
    makeImportReport("telegram", "2026-10-07", { ...body, candidates: [{ ticker: "AZN", entryPrice: 101 }] }),
  ]) assert.notEqual(other.fingerprint, base);
});
test("unknown, impossible and future market data dates cannot silently masquerade as valid reports", () => {
  assert.throws(() => makeImportReport("edgeai", "2026-02-30", {}));
  assert.throws(() => makeImportReport("edgeai", "2026-10-07", {}, "bad"));
  assert.throws(() => makeImportReport("edgeai", "2026-10-07", {}, null, { SE: "2026-10-08", US: null }));
  assert.equal(makeImportReport("telegram", "2026-10-07", {}).dataDates.SE, null);
});
test("normalization preserves US punctuation and financial identity; different sources/dates remain distinct", () => {
  assert.equal(normalizeImportSymbol(" hm_b.st "), "HM-B");
  assert.equal(normalizeImportSymbol(" brk.b ", "US"), "BRK.B");
  const a = { market: "SE", category: "MOMENTUM", ticker: "HM B", direction: "LONG", signalSource: "edgeai", signalDate: "2026-10-07" };
  assert.equal(candidateIdentity(a), candidateIdentity({ ...a, ticker: "HM-B.ST" }));
  assert.notEqual(candidateIdentity(a), candidateIdentity({ ...a, signalSource: "telegram" }));
  assert.notEqual(candidateIdentity(a), candidateIdentity({ ...a, signalDate: "2026-10-08" }));
  assert.notEqual(
    makeImportReport("telegram", "2026-10-07", { candidates: [{ market: "US", ticker: "BRK_B" }] }).fingerprint,
    makeImportReport("telegram", "2026-10-07", { candidates: [{ market: "US", ticker: "BRK B" }] }).fingerprint,
  );
});
test("identical duplicate setups collapse; conflicting plans fail explicitly instead of keeping the first", () => {
  const a = { ticker: "HM B", category: "MOMENTUM", direction: "LONG", entryPrice: 100, stopPrice: 95, targetPrice: 110, rr: 2 };
  const result = deduplicateCandidates([a, { ...a, ticker: "HM-B.ST" }]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(deduplicateCandidates([a, { ...a, stopPrice: 95.000002 }]).candidates.length, 1);
  assert.throws(() => deduplicateCandidates([a, { ...a, entryPrice: 101 }]), /Motstridiga/);
});
test("same report receipt returns existing signal history without writes, deletions or a new recommendation version", async () => {
  const report = makeImportReport("edgeai", "2026-10-07", { price: 100 });
  const history = { id: 1, ticker: "HM-B", outcome: "WIN", realizedR: 1.5 };
  const queue = [[], [{ date: "2026-10-08", sourceReports: [{ ...report, importedAt: "2026-10-08T08:00:00Z" }] }], [history]];
  const tx = {
    select: () => ({ from: () => ({ where: async () => queue.shift() }) }),
    update: () => { throw new Error("Unexpected write"); },
    insert: () => { throw new Error("Unexpected insert"); },
    delete: () => { throw new Error("Unexpected deletion"); },
  };
  const result = await synchronizeCandidates(tx, 1, [], new Date("2026-10-08T09:00:00Z"), report);
  assert.equal(result.duplicateReport, true);
  assert.deepEqual(result.candidates, [history]);
  assert.deepEqual(result.diff, { added: [], updated: [], removed: [] });
  assert.equal(queue.length, 0);
});
