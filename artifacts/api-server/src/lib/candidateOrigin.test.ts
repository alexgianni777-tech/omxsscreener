import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateOrigin } from "./candidateOrigin";

test("explicit origin takes precedence over compatibility inference", () => {
  assert.equal(candidateOrigin("legacy", "telegram"), "legacy");
  assert.equal(candidateOrigin("manual", "edgeai"), "manual");
});

test("known historical source tags provide a read-only origin", () => {
  assert.equal(candidateOrigin(null, "edgeai"), "edgeai");
  assert.equal(candidateOrigin(null, "telegram"), "legacy");
  assert.equal(candidateOrigin(null, "manual"), "manual");
  assert.equal(candidateOrigin(null, "screener"), null);
  assert.equal(candidateOrigin(null, null), null);
});