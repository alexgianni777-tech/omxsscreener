type TestEnvironment = Record<string, string | undefined>;

export function isE2ETestMode(env: TestEnvironment = process.env): boolean {
  return env.E2E_TEST === "1";
}

/**
 * E2E mode is deliberately restricted to one local, disposable PostgreSQL
 * shape. Run this before dynamically importing any module that creates a DB
 * pool. E2E_TEST=0 or unset leaves normal startup unchanged.
 */
export function prepareE2ETestMode(env: TestEnvironment): boolean {
  const flag = env.E2E_TEST;
  if (flag === undefined || flag === "0") return false;
  if (flag !== "1") throw new Error("E2E_TEST must be unset, 0, or 1.");
  if (env.NODE_ENV === "production") {
    throw new Error("E2E_TEST cannot be enabled in production.");
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  const aliasUrl = env.DB_URL?.trim();
  if (databaseUrl && aliasUrl && databaseUrl !== aliasUrl) {
    throw new Error("E2E_TEST refused: DB_URL and DATABASE_URL do not match.");
  }
  const urlValue = databaseUrl ?? aliasUrl;
  if (!urlValue) throw new Error("E2E_TEST refused: a temporary local PostgreSQL URL is required.");

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("E2E_TEST refused: database URL is invalid.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const localHost = url.hostname === "127.0.0.1";
  const localTestDatabase = url.protocol === "postgresql:" || url.protocol === "postgres:";
  if (
    !localTestDatabase ||
    !localHost ||
    url.port !== "55432" ||
    url.username !== "asf_e2e" ||
    url.password !== "" ||
    !/^asf_e2e_[a-z0-9_]+$/.test(databaseName) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "E2E_TEST refused: use only user asf_e2e, database asf_e2e_*, and local PostgreSQL at 127.0.0.1:55432.",
    );
  }

  if (!databaseUrl) env.DATABASE_URL = urlValue;
  return true;
}
