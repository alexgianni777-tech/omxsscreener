import type { RequestHandler } from "express";

/** Mount AFTER owner authentication. Keep Autoscale CPU allocated until the
 * shared check finishes, before reading the latest list. Historic detail,
 * quotes and journal requests do not start an import or wait for enrichment.
 */
export function createImportWakeMiddleware(check: () => Promise<unknown>): RequestHandler {
  return async (req, _res, next) => {
    if (req.method === "GET" &&
      ["/screener/sessions", "/screener/top3/last-valid"].includes(req.path)) {
      try { await check(); } catch { /* Existing saved list remains available. */ }
    }
    next();
  };
}
