import assert from "node:assert/strict";
import test from "node:test";
import { createLatestRequestGuard } from "./latestRequestGuard";

test("a delayed pre-cutoff response cannot overwrite a newer sealed response", async () => {
  const guard = createLatestRequestGuard();
  let finishOld!: (value: string) => void;
  const oldResponse = new Promise<string>((resolve) => { finishOld = resolve; });
  let displayed = "";
  const oldIsCurrent = guard.begin();
  const oldLoad = oldResponse.then((value) => {
    if (oldIsCurrent()) displayed = value;
  });
  const newIsCurrent = guard.begin();
  if (newIsCurrent()) displayed = "MISSING_SOURCES";
  finishOld("PRELIMINARY");
  await oldLoad;
  assert.equal(displayed, "MISSING_SOURCES");
  assert.equal(oldIsCurrent(), false);
  assert.equal(newIsCurrent(), true);
});

test("unmount invalidates outstanding refreshes", () => {
  const guard = createLatestRequestGuard();
  const isCurrent = guard.begin();
  guard.invalidate();
  assert.equal(isCurrent(), false);
});