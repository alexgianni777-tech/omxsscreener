import test from "node:test";
import assert from "node:assert/strict";
import { GitHubContentsClient, GitHubFetchError } from "./githubContents";

const parse = (v: unknown) => v as { version: number };
const valid = (v: { version: number }) => Number.isFinite(v.version);

test("canonical fetch coalesces, caches and revalidates ETag; 304 keeps exact data", async () => {
  let now = 1_000_000;
  let calls = 0;
  const client = new GitHubContentsClient("https://api.github.com/test", async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({ version: 1 }, { headers: { etag: '"v1"' } });
    assert.equal((init?.headers as Record<string, string>)["If-None-Match"], '"v1"');
    return new Response(null, { status: 304 });
  }, () => now);
  const [a, b] = await Promise.all([client.load(1000, parse, valid), client.load(1000, parse, valid)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  await client.load(1000, parse, valid);
  assert.equal(calls, 1);
  now += 300_001;
  assert.deepEqual(await client.load(1000, parse, valid), { version: 1 });
  assert.equal(calls, 2);
});

test("403 rate limit respects reset and Retry-After, no request during backoff or stale fallback", async () => {
  let now = 1_000_000;
  let calls = 0;
  const client = new GitHubContentsClient("https://api.github.com/test", async () => {
    calls++;
    if (calls === 1) return Response.json({ version: 1 });
    return new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: {
      "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((now + 3_600_000) / 1000), "retry-after": "1800",
    } });
  }, () => now);
  await client.load(1000, parse, valid);
  now += 300_001;
  await assert.rejects(client.load(1000, parse, valid), error => error instanceof GitHubFetchError &&
    error.status === 403 && Date.parse(error.retryAt) === now + 3_600_000 && /Rate limit bekräftad/.test(error.message));
  await assert.rejects(client.load(1000, parse, valid), GitHubFetchError);
  assert.equal(calls, 2);
  now += 3_600_001;
  await assert.rejects(client.load(1000, parse, valid), GitHubFetchError);
  assert.equal(calls, 3);
});

test("403 without rate-limit evidence is access denied, not misclassified; 429 also backs off", async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const client = new GitHubContentsClient("https://api.github.com/test", async () => {
      calls++; return new Response("Forbidden", { status, headers: { "retry-after": "60" } });
    });
    await assert.rejects(client.load(1000, parse, valid), status === 403 ? /rate limit ej bekräftad/ : /Rate limit bekräftad/);
    await assert.rejects(client.load(1000, parse, valid));
    assert.equal(calls, 1);
  }
});

test("invalid JSON and invalid envelope cannot replace a valid cache", async () => {
  let now = 1_000_000;
  let calls = 0;
  const client = new GitHubContentsClient("https://api.github.com/test", async () => {
    calls++;
    return calls === 1 ? Response.json({ version: 1 }, { headers: { etag: '"good"' } }) :
      calls === 2 ? Response.json({ bad: true }) : new Response("not JSON");
  }, () => now);
  await client.load(1000, parse, valid);
  now += 300_001;
  const invalid = await client.load(1000, parse, valid);
  assert.equal(valid(invalid), false);
  await assert.rejects(client.load(1000, parse, valid), /invalid JSON/);
  assert.equal(calls, 3);
});
