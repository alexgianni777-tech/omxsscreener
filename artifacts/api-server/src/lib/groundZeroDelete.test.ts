import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { createGroundZeroDeleteHandler } from "./groundZeroDelete";

async function request(id: string, remove: (id: number) => Promise<unknown | null>) {
  let status = 200;
  let body: unknown;
  const res = {
    status(n: number) { status = n; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  await createGroundZeroDeleteHandler(remove)({ params: { id } } as unknown as Request, res);
  return { status, body };
}
test("delete validates ID before repository access", async () => {
  for (const id of ["0", "-1", "1.2", "no", "2147483648"]) {
    const result = await request(id, async () => { throw new Error("must not access DB"); });
    assert.equal(result.status, 400);
  }
});
test("delete removes only requested reconciliation and returns remaining state", async () => {
  const remaining = { latest: { id: 1, totalValueSek: 17514 }, history: [{ id: 1, totalValueSek: 17514 }] };
  const calls: number[] = [];
  const result = await request("2", async id => { calls.push(id); return remaining; });
  assert.deepEqual(calls, [2]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, remaining);
});
test("last reconciliation removal returns no guessed balance; missing ID is 404", async () => {
  assert.deepEqual((await request("1", async () => ({ latest: null, history: [] }))).body,
    { latest: null, history: [] });
  assert.equal((await request("1", async () => null)).status, 404);
});
test("repository failures are not reported as successful deletion", async () => {
  await assert.rejects(request("1", async () => { throw new Error("DB unavailable"); }), /DB unavailable/);
});
test("ground zero deletion is ID scoped, transactional and behind private API guards", () => {
  const route = readFileSync(new URL("../routes/groundZero.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
  assert.match(route, /db\.transaction/);
  assert.match(route, /\.where\(eq\(groundZeroSnapshotsTable\.id, id\)\)/);
  assert.match(route, /removed\.length \? state\(tx\) : null/);
  assert.ok(index.indexOf("router.use(requireAdministrator)") < index.indexOf("router.use(groundZeroRouter)"));
});
