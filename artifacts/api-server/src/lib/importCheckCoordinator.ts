/**
 * Coalesce wake, timer and webhook checks. At most one check per interval in
 * this process; session advisory locks + durable receipts protect other instances.
 * Failed checks are also throttled, so a busy dashboard cannot flood upstream.
 */
export function createImportCheckCoordinator<T>(
  run: () => Promise<T>,
  intervalMs: number,
  now: () => number = Date.now,
) {
  let pending: Promise<T> | undefined;
  let lastStarted = -Infinity;
  let result: T;
  let completed = false;
  let failure: unknown;
  let failed = false;
  return function check(): Promise<T> {
    if (pending) return pending;
    if (completed && now() - lastStarted < intervalMs) {
      return failed ? Promise.reject(failure) : Promise.resolve(result);
    }
    lastStarted = now();
    const task = Promise.resolve().then(run).then(value => {
      result = value;
      completed = true;
      failed = false;
      return value;
    }, error => {
      completed = true;
      failed = true;
      failure = error;
      throw error;
    });
    pending = task.finally(() => { pending = undefined; });
    return pending;
  };
}
