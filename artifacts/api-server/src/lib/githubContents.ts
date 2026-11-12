const FIVE_MINUTES = 5 * 60_000;

export class GitHubFetchError extends Error {
  constructor(message: string, public status: number | null, public retryAt: string) {
    super(message);
    this.name = "GitHubFetchError";
  }
}

/** One canonical URL, coalesced requests, conditional GET and no CDN fallback. */
export class GitHubContentsClient {
  private cache: { data: unknown; etag: string | null; checkedAt: number } | null = null;
  private pending: Promise<{ data: unknown; etag: string | null }> | null = null;
  private retryAt = 0;
  private failures = 0;
  private lastError: GitHubFetchError | null = null;
  constructor(
    private url: string,
    private request: typeof fetch = (...args) => fetch(...args),
    private clock: () => number = Date.now,
    private cacheMs = FIVE_MINUTES,
  ) {}

  async load<T>(timeoutMs: number, validate: (data: unknown) => T, cacheable: (value: T) => boolean): Promise<T> {
    const now = this.clock();
    // Never serve a successful cache as a substitute for a newer failed fetch.
    if (now < this.retryAt && this.lastError) throw this.lastError;
    if (this.cache && now - this.cache.checkedAt < this.cacheMs) return validate(this.cache.data);
    if (!this.pending) {
      this.pending = this.download(timeoutMs).finally(() => { this.pending = null; });
    }
    const response = await this.pending;
    const result = validate(response.data);
    if (cacheable(result)) this.cache = { ...response, checkedAt: this.clock() };
    return result;
  }

  private async download(timeoutMs: number): Promise<{ data: unknown; etag: string | null }> {
    let response: Response;
    try {
      response = await this.request(this.url, {
        headers: {
          Accept: "application/vnd.github.raw+json",
          "User-Agent": "omxs30-screener",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(this.cache?.etag ? { "If-None-Match": this.cache.etag } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw this.failure(null, "Nätverksfel vid GitHub Contents API.", null);
    }
    if (response.status === 304 && this.cache) {
      this.failures = 0;
      this.lastError = null;
      return { data: this.cache.data, etag: this.cache.etag };
    }
    if (!response.ok) {
      // Inspect only for classification; do not log arbitrary response bodies.
      const body = await response.text().catch(() => "");
      const rateLimited = response.status === 429 || response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(body));
      const reason = rateLimited ? "Rate limit bekräftad"
        : response.status === 403 ? "Åtkomst nekad; rate limit ej bekräftad" : "Hämtfel";
      throw this.failure(response.status, reason, response.headers);
    }
    let data: unknown;
    try { data = await response.json(); }
    catch { throw this.failure(response.status, "GitHub Contents API returned invalid JSON", null); }
    this.failures = 0;
    this.lastError = null;
    this.retryAt = 0;
    return { data, etag: response.headers.get("etag") };
  }

  private failure(status: number | null, reason: string, headers: Headers | null): GitHubFetchError {
    const now = this.clock();
    this.failures++;
    const retryAfter = headers?.get("retry-after");
    const retryMs = retryAfter && /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter ?? "");
    const resetMs = Number(headers?.get("x-ratelimit-reset")) * 1000;
    const exponential = Math.min(60 * 60_000, (status === 403 || status === 429 ? 15 * 60_000 : 60_000) * 2 ** Math.min(this.failures - 1, 4));
    this.retryAt = Math.max(now + exponential, Number.isFinite(retryMs) ? retryMs : 0, Number.isFinite(resetMs) ? resetMs : 0);
    const retryAt = new Date(this.retryAt).toISOString();
    this.lastError = new GitHubFetchError(
      `EdgeAI GitHub Contents API failed (HTTP ${status ?? "network"}): ${reason}. Nästa försök tidigast ${retryAt}; no CDN fallback was used.`,
      status, retryAt,
    );
    return this.lastError;
  }
}
