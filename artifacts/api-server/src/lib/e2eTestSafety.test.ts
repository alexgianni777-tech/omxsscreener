import test from "node:test";
import assert from "node:assert/strict";
import { prepareE2ETestMode } from "./e2eTestSafety";
import { fetchFreshEdgeAiData } from "./edgeAiSource";

const localUrl = "postgresql://asf_e2e@127.0.0.1:55432/asf_e2e_qa";

test("normal startup is unchanged when E2E_TEST is unset or zero", () => {
  assert.equal(prepareE2ETestMode({ NODE_ENV: "production" }), false);
  assert.equal(prepareE2ETestMode({ E2E_TEST: "0", NODE_ENV: "development" }), false);
});

test("E2E_TEST accepts only a separate local test database and normalizes DB_URL", () => {
  const env: Record<string, string | undefined> = { E2E_TEST: "1", NODE_ENV: "development", DB_URL: localUrl };
  assert.equal(prepareE2ETestMode(env), true);
  assert.equal(env.DATABASE_URL, localUrl);
});

test("E2E_TEST fails closed for production, missing, remote, or mismatched database URLs", () => {
  for (const env of [
    { E2E_TEST: "1", NODE_ENV: "production", DATABASE_URL: localUrl },
    { E2E_TEST: "1", NODE_ENV: "development" },
    { E2E_TEST: "1", NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@db.example.com:5432/prod" },
    { E2E_TEST: "1", NODE_ENV: "development", DATABASE_URL: "postgresql://asf_e2e@127.0.0.1:5432/asf_e2e_qa" },
    { E2E_TEST: "1", NODE_ENV: "development", DATABASE_URL: localUrl, DB_URL: "postgresql://asf_e2e@127.0.0.1:55432/asf_e2e_other" },
  ]) {
    assert.throws(() => prepareE2ETestMode(env), /E2E_TEST refused|cannot be enabled/);
  }
});

test("E2E_TEST blocks EdgeAI network fetch before attempting any request", async () => {
  const previous = process.env.E2E_TEST;
  process.env.E2E_TEST = "1";
  try {
    await assert.rejects(fetchFreshEdgeAiData(100), /disabled in isolated E2E_TEST mode/);
  } finally {
    if (previous === undefined) delete process.env.E2E_TEST;
    else process.env.E2E_TEST = previous;
  }
});
