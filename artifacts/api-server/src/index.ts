import app from "./app";
import { logger } from "./lib/logger";
// Automatic EdgeAI polling is disabled by request — the user triggers EdgeAI
// import manually from the dashboard instead. scheduler.ts is kept around
// (unused) in case automatic polling is wanted again later.
// import { startScheduler } from "./lib/scheduler";
import { runMigrations } from "./lib/migrate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  // Apply pending versioned schema migrations before accepting traffic.
  // runMigrations uses a PostgreSQL advisory lock, so concurrent instances
  // serialize safely during deployment.
  await runMigrations();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    // Automatic EdgeAI polling disabled — trigger imports manually instead.
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error — process cannot continue");
  process.exit(1);
});
