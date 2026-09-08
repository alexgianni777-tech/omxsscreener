import assert from "node:assert/strict";
import test from "node:test";

import { afterSessionWriteLock } from "./sessionWriteSerialization.ts";

test("concurrent session writers cannot read or write before their advisory lock", async () => {
  const events: string[] = [];
  const state = {
    outcome: "PENDING",
    realizedR: null as number | null,
    resolutionEntryPrice: null as number | null,
    resolutionStopPrice: null as number | null,
    linkedPnlKr: null as number | null,
  };
  let releaseFirst!: () => void;
  let signalFirstRead!: () => void;
  let firstHoldsLock = false;
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstRead = new Promise<void>((resolve) => { signalFirstRead = resolve; });

  const first = afterSessionWriteLock(
    async () => {
      events.push("first:lock");
      firstHoldsLock = true;
    },
    async () => {
      events.push("first:read");
      signalFirstRead();
      await firstReleased;
      events.push("first:write");
      Object.assign(state, {
        outcome: "WIN",
        realizedR: 2,
        resolutionEntryPrice: 100,
        resolutionStopPrice: 95,
        linkedPnlKr: 1_000,
      });
      firstHoldsLock = false;
    },
  );

  await firstRead;
  const second = afterSessionWriteLock(
    async () => {
      events.push("second:lock-request");
      while (firstHoldsLock) await new Promise((resolve) => setImmediate(resolve));
      events.push("second:lock");
    },
    async () => {
      events.push("second:read");
      const lockedCurrent = { ...state };
      // Mirrors synchronization: imports may update plan fields, but preserve
      // the freshly re-read resolution and linked financial result.
      Object.assign(state, lockedCurrent);
      events.push("second:write");
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  const beforeRelease = [...events];
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(beforeRelease, ["first:lock", "first:read", "second:lock-request"]);
  assert.deepEqual(events, [
    "first:lock",
    "first:read",
    "second:lock-request",
    "first:write",
    "second:lock",
    "second:read",
    "second:write",
  ]);
  assert.deepEqual(state, {
    outcome: "WIN",
    realizedR: 2,
    resolutionEntryPrice: 100,
    resolutionStopPrice: 95,
    linkedPnlKr: 1_000,
  });
});