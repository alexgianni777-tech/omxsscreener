/**
 * Keep the lock acquisition structurally ahead of every authoritative read or
 * write in a session-scoped candidate mutation. The injected acquire function
 * makes the ordering deterministic to regression-test without a live database.
 */
export async function afterSessionWriteLock<T>(
  acquire: () => Promise<void>,
  writer: () => Promise<T>,
): Promise<T> {
  await acquire();
  return writer();
}