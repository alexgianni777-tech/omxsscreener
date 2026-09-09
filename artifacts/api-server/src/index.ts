import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
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
    // Start only after listen succeeds: migrations and the HTTP startup path
    // are complete, and the scheduler can safely use the live DB connection.
    startScheduler();
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error — process cannot continue");
  process.exit(1);
});
