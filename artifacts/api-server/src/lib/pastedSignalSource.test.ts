import assert from "node:assert/strict";
import test from "node:test";
import { ImportSessionBody, ReimportSessionBody } from "@workspace/api-zod";
import { pastedSignalSource } from "./pastedSignalSource";
import { candidateIdentity, effectiveCandidateInputs } from "./candidateSynchronizationPolicy";

test("create and reimport schemas require explicit boolean Telegram confirmation", () => {
  for (const schema of [ImportSessionBody, ReimportSessionBody]) {
    assert.equal(pastedSignalSource(schema.parse({ rawText: "report" }).confirmedTelegram), "manual");
    assert.equal(pastedSignalSource(schema.parse({ rawText: "report", confirmedTelegram: false }).confirmedTelegram), "manual");
    assert.equal(pastedSignalSource(schema.parse({ rawText: "report", force: true, confirmedTelegram: true }).confirmedTelegram), "telegram");
    assert.equal(schema.safeParse({ rawText: "report", confirmedTelegram: "true" }).success, false);
    assert.equal(pastedSignalSource(schema.parse({ rawText: "report", signalSource: "telegram" }).confirmedTelegram), "manual");
  }
});

test("repeat confirmed imports reuse Telegram identity and preserve other-source outcomes", () => {
  const setup = { market: "SE", category: "WEAKEST", ticker: "ABC", direction: "SHORT" };
  const manual = { ...setup, signalSource: "manual", outcome: "WIN", id: 1 };
  const telegram = { ...setup, signalSource: pastedSignalSource(true), id: 2 };
  const edgeai = { ...setup, signalSource: "edgeai", id: 3 };
  const merged = effectiveCandidateInputs([telegram], [manual, telegram, edgeai]);
  assert.equal(merged.length, 3);
  assert.equal(merged.filter((row) => candidateIdentity(row) === candidateIdentity(telegram)).length, 1);
  assert.equal(merged.find((row) => row.signalSource === "manual"), manual);
  assert.equal(manual.outcome, "WIN");
});