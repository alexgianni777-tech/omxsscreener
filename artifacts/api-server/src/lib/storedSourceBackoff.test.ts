import test from "node:test";
import assert from "node:assert/strict";
import { activeSourceBackoff, attachFetchDiagnostic } from "./storedSourceBackoff";
import { makeImportReport } from "./importReport";
import { GitHubFetchError } from "./githubContents";

test("persisted failure protects a new process; later success or expired cooldown releases it", () => {
  const base = makeImportReport("edgeai", "2026-11-04", {});
  const failure = { ...base, status: "FAILED" as const, importedAt: "2026-11-04T12:00:00Z",
    retryAt: "2026-11-04T13:00:00Z", httpStatus: 403 };
  const now = Date.parse("2026-11-04T12:30:00Z");
  assert.equal(activeSourceBackoff([failure], now)?.httpStatus, 403);
  assert.equal(activeSourceBackoff([failure], Date.parse("2026-11-04T13:00:00Z")), null);
  assert.equal(activeSourceBackoff([failure, { ...base, importedAt: "2026-11-04T12:20:00Z" }], now), null);
  assert.equal(activeSourceBackoff([{ ...failure, source: "telegram" }], now), null);
  attachFetchDiagnostic(base, new GitHubFetchError("rate limited", 403, failure.retryAt));
  assert.equal(base.retryAt, failure.retryAt);
  assert.equal(base.httpStatus, 403);
});
