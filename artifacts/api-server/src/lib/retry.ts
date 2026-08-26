/**
 * Small retry helper for flaky upstream calls (Yahoo Finance quotes/history).
 * A single transient hiccup should not downgrade a whole session's market-RSI
 * to 0 or a candidate's volume to "missing" — retry a couple of times with a
 * short backoff before giving up and letting the caller fall back.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 400 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}
